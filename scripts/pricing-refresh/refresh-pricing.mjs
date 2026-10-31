#!/usr/bin/env node
// Pricing auto-refresh CLI.
//
// Usage:
//   node scripts/pricing-refresh/refresh-pricing.mjs [options]
//
// Options:
//   --only a,b,c        Only refresh the given vendors (default: all).
//   --dry-run           Report what would change; do not write anything.
//   --from-file <path>  Parse a saved page (fixture) instead of fetching.
//                       Requires --only with exactly one vendor.
//   --data-file <path>  Read/write this pricing file (default: data/pricing.json).
//   --commit            Commit, push a branch and open a PR (CI mode).
//
// The merge is add/modify-only (retired models are kept with a warning), and a
// per-vendor circuit breaker skips any vendor whose parse produced no models
// or lost more than half of its known models.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { fetchText, formatPricing, mergePricing, validatePricing } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GENERATOR = path.join(ROOT, "scripts", "generate-pricing-data.mjs");

// Vendors that have a parser. Each entry points at the parser module and the
// fixture used by --from-file / tests (fixture names live in
// test/fixtures/pricing/). An optional `fetch` field points at a custom
// fetcher module (default: lib.mjs fetchText); used by vendors whose page
// cannot be fetched directly from CI (e.g. sensecore.cn WAF-blocks
// datacenter IPs, so sensenova goes through a residential proxy).
export const VENDORS = {
  deepseek: { parser: "./parsers/deepseek.mjs", fixture: "deepseek.html" },
  google: { parser: "./parsers/google.mjs", fixture: "google-pricing.html" },
  kimi: { parser: "./parsers/kimi.mjs", fixture: "kimi-pricing.html" },
  openai: { parser: "./parsers/openai.mjs", fixture: "openai-pricing.html" },
  anthropic: { parser: "./parsers/anthropic.mjs", fixture: "anthropic-pricing.html" },
  glm: { parser: "./parsers/glm.mjs", fixture: "glm-pricing.md" },
  mimo: { parser: "./parsers/mimo.mjs", fixture: "mimo-pricing.md" },
  minimax: { parser: "./parsers/minimax.mjs", fixture: "minimax-pricing.html" },
  stepfun: { parser: "./parsers/stepfun.mjs", fixture: "stepfun-pricing.md" },
  qwen: { parser: "./parsers/qwen.mjs", fixture: "qwen-pricing.html" },
  sensenova: { parser: "./parsers/sensenova.mjs", fixture: "sensenova-pricing.html", fetch: "./fetchers/scrapingbee.mjs" },
};

function parseArgs(argv) {
  const args = { only: null, dryRun: false, fromFile: null, dataFile: null, commit: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") args.only = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--from-file") args.fromFile = argv[++i];
    else if (arg === "--data-file") args.dataFile = argv[++i];
    else if (arg === "--commit") args.commit = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function remoteBranchExists(branch) {
  try {
    git(["ls-remote", "--exit-code", "--heads", "origin", branch]);
    return true;
  } catch {
    return false;
  }
}

function remoteOwner() {
  const url = git(["remote", "get-url", "origin"]);
  const m = url.match(/github\.com[:/]([^/]+)\//);
  return m ? m[1] : "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/pricing-refresh/refresh-pricing.mjs [--only a,b] [--dry-run] [--from-file <path>] [--data-file <path>] [--commit]");
    return;
  }

  let vendorNames = Object.keys(VENDORS);
  if (args.only) {
    vendorNames = args.only.split(",").map((s) => s.trim()).filter(Boolean);
    for (const name of vendorNames) {
      if (!VENDORS[name]) {
        console.error(`Unknown vendor: ${name} (known: ${Object.keys(VENDORS).join(", ")})`);
        process.exit(2);
      }
    }
  }
  if (args.fromFile) {
    if (vendorNames.length !== 1) {
      console.error("--from-file requires --only with exactly one vendor");
      process.exit(2);
    }
    if (!existsSync(args.fromFile)) {
      console.error(`--from-file: file not found: ${args.fromFile}`);
      process.exit(2);
    }
  }
  if (args.commit && args.dryRun) {
    console.error("--commit and --dry-run are mutually exclusive");
    process.exit(2);
  }

  const dataFile = path.resolve(ROOT, args.dataFile ?? "data/pricing.json");
  const existing = JSON.parse(await readFile(dataFile, "utf8"));

  const vendorScrapes = [];
  const fetchErrors = [];
  for (const vendor of vendorNames) {
    const spec = VENDORS[vendor];
    const sourceUrl = existing.catalogs?.[vendor]?.sourceUrl;
    let content;
    try {
      if (args.fromFile) {
        content = await readFile(args.fromFile, "utf8");
      } else if (spec.fetch) {
        const { fetchText: vendorFetchText } = await import(new URL(spec.fetch, import.meta.url));
        content = await vendorFetchText(sourceUrl);
      } else {
        content = await fetchText(sourceUrl);
      }
    } catch (error) {
      fetchErrors.push(`${vendor}: ${error.message}`);
      continue;
    }
    const { parse } = await import(new URL(spec.parser, import.meta.url));
    let models;
    try {
      models = await parse(content);
    } catch (error) {
      fetchErrors.push(`${vendor}: parse failed: ${error.message}`);
      continue;
    }
    const baseline = existing.catalogs?.[vendor]?.models
      ? Object.keys(existing.catalogs[vendor].models)
      : [];
    vendorScrapes.push({ vendor, models, baselineIds: baseline });
  }

  let { data, added, modified, keptRetired, warnings } = mergePricing(existing, vendorScrapes);

  // Stamp the top-level and per-vendor updatedAt for the vendors this run
  // actually changed. Re-called after a same-day rerun rebase, when the
  // changed-vendor set is recomputed against the refresh branch.
  const stampChanged = () => {
    for (const vendor of vendorNames) {
      if (added.some((e) => e.startsWith(`${vendor}/`)) || modified.some((e) => e.startsWith(`${vendor}/`))) {
        data.catalogs[vendor] = { ...data.catalogs[vendor], updatedAt: today() };
      }
    }
    data.updatedAt = today();
  };

  const changed = added.length > 0 || modified.length > 0;
  if (changed) stampChanged();

  console.log(`vendors: ${vendorNames.join(", ")}`);
  for (const w of warnings) console.log(`warn: ${w}`);
  for (const e of fetchErrors) console.log(`error: ${e}`);
  console.log(`added: ${added.length ? added.join(", ") : "none"}`);
  console.log(`modified: ${modified.length ? modified.join(", ") : "none"}`);
  console.log(`kept retired: ${keptRetired.length ? keptRetired.join(", ") : "none"}`);

  if (!changed) {
    console.log("no changes; nothing to do");
    if (fetchErrors.length > 0) process.exit(1);
    return;
  }

  const validated = validatePricing(data);
  const serialized = formatPricing(validated);

  if (args.dryRun) {
    console.log("dry-run: would update " + path.relative(ROOT, dataFile));
    console.log("dry-run: would regenerate src/pricing-data.ts");
    if (fetchErrors.length > 0) process.exit(1);
    return;
  }

  await writeFile(dataFile, serialized, "utf8");
  execFileSync(process.execPath, [GENERATOR], { cwd: ROOT, stdio: "inherit" });
  console.log(`updated ${path.relative(ROOT, dataFile)} and regenerated src/pricing-data.ts`);

  if (args.commit) {
    const branch = `pricing-refresh-${today()}`;
    const gh = (args) => execFileSync("gh", args, { cwd: ROOT, encoding: "utf8" }).trim();
    // On a same-day rerun, base this run on the refresh branch's own data file
    // so price changes from earlier runs are preserved, not overwritten.
    if (remoteBranchExists(branch)) {
      git(["fetch", "origin", branch]);
      const branchData = git(["show", `origin/${branch}:data/pricing.json`]);
      const merged = mergePricing(JSON.parse(branchData), vendorScrapes);
      data = merged.data;
      added = merged.added;
      modified = merged.modified;
      keptRetired = merged.keptRetired;
      warnings = merged.warnings;
      const revalidated = validatePricing(data);
      await writeFile(dataFile, formatPricing(revalidated), "utf8");
      execFileSync(process.execPath, [GENERATOR], { cwd: ROOT, stdio: "inherit" });
      stampChanged();
      console.log(`rerun: rebased this scrape onto ${branch}'s pending pricing changes`);
    }
    // If everything scraped is already on the refresh branch, there is
    // nothing new to commit; the branch and its PR are up to date.
    if (added.length === 0 && modified.length === 0) {
      // Undo the rebase's writes so the working tree stays clean.
      git(["checkout", "--", "data/pricing.json", "src/pricing-data.ts"]);
      console.log("no new changes beyond the refresh branch; nothing to do");
      if (fetchErrors.length > 0) process.exit(1);
      return;
    }
    const vendorsChanged = [...new Set([...added, ...modified].map((e) => e.split("/")[0]))].sort();
    git(["checkout", "-B", branch]);
    git(["add", "data/pricing.json", "src/pricing-data.ts"]);
    const bodyLines = [
      `Auto-refreshed model pricing for: ${vendorsChanged.join(", ")}.`,
      "",
      `- added: ${added.length ? added.join(", ") : "none"}`,
      `- modified: ${modified.length ? modified.join(", ") : "none"}`,
      `- kept retired: ${keptRetired.length ? keptRetired.join(", ") : "none"}`,
    ];
    for (const w of warnings) bodyLines.push(`- warn: ${w}`);
    for (const e of fetchErrors) bodyLines.push(`- error: ${e}`);
    const title = `chore(pricing): refresh model pricing (${vendorsChanged.join(", ")})`;
    const body = bodyLines.join("\n");
    git(["commit", "-m", title, "-m", body]);
    git(["push", "-f", "origin", branch]);
    // A same-day rerun reuses the branch; reuse its open PR instead of
    // duplicating. --head matches on branch name only, so also require the
    // head repo to be this repository to ignore same-named fork PRs.
    const owner = remoteOwner();
    const existingPr = gh([
      "pr", "list", "--head", branch, "--state", "open",
      "--json", "url,headRepositoryOwner",
      "--jq", `.[] | select(.headRepositoryOwner.login == "${owner}") | .url | select(length > 0)`,
    ]).split("\n").filter(Boolean)[0] ?? "";
    if (existingPr) {
      // Refresh the PR's title and body so they describe this run, not the first.
      gh(["pr", "edit", existingPr, "--title", title, "-b", body]);
      console.log(`PR: ${existingPr} (updated)`);
    } else {
      const prUrl = gh(["pr", "create", "--fill", "--title", title, "-b", body, "--head", branch]);
      console.log(`PR: ${prUrl}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message ?? String(error));
  process.exit(1);
});
