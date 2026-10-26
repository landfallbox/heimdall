#!/usr/bin/env node
// CLI: refresh data/model-info.json from official model documentation pages.
//
// Usage:
//   node scripts/model-info-refresh/refresh-model-info.mjs [options]
//
// Options:
//   --only <vendor>       Only refresh the given vendor (repeatable).
//                         Vendors: anthropic, deepseek, google, kimi, glm.
//   --dry-run             Print the report without writing any file.
//   --commit              After writing, create a model-info-refresh-YYYYMMDD
//                         branch, commit, and open a PR (for CI).
//   --from-file <dir>     Read vendor pages from fixture files in <dir>
//                         instead of the network (used by tests).
//
// Vendors without a structured source (openai, mimo) are maintained manually
// and are reported as such.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText, formatModelInfo, mergeModelInfo, validateModelInfo } from "./lib.mjs";
import * as anthropic from "./parsers/anthropic.mjs";
import * as deepseek from "./parsers/deepseek.mjs";
import * as glm from "./parsers/glm.mjs";
import * as google from "./parsers/google.mjs";
import * as kimi from "./parsers/kimi.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_FILE = path.join(ROOT, "data/model-info.json");
const GENERATOR = path.join(ROOT, "scripts/generate-model-info-data.mjs");

const VENDORS = {
  anthropic: {
    url: "https://platform.claude.com/docs/en/models/overview",
    fixture: "anthropic.html",
    idPrefixes: ["claude-"],
    parser: anthropic,
  },
  deepseek: {
    url: "https://api-docs.deepseek.com/quick_start/pricing",
    fixture: "deepseek.html",
    idPrefixes: ["deepseek-"],
    parser: deepseek,
  },
  google: {
    url: "https://ai.google.dev/gemini-api/docs/models",
    fixture: "google-list.html",
    idPrefixes: ["gemini-"],
    parser: google,
  },
  kimi: {
    url: "https://platform.kimi.ai/docs/models.md",
    fixture: "kimi-models.md",
    idPrefixes: ["kimi-", "moonshot-"],
    parser: kimi,
  },
  glm: {
    url: "https://docs.bigmodel.cn/cn/guide/models",
    fixture: "glm-index.html",
    idPrefixes: ["glm-"],
    parser: glm,
  },
};

// Vendors whose pages cannot be parsed reliably; kept for the report only.
const MANUAL_VENDORS = {
  openai: "platform.openai.com/docs/models returns HTTP 403 to scripts; maintained manually",
  mimo: "Xiaomi MiMo docs are a JS-rendered SPA without a static source; maintained manually",
};

function parseArgs(argv) {
  const args = { only: [], dryRun: false, commit: false, fromFile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") args.only.push(argv[++i]);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--commit") args.commit = true;
    else if (arg === "--from-file") args.fromFile = path.resolve(argv[++i]);
    else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  for (const vendor of args.only) {
    if (!VENDORS[vendor]) throw new Error(`unknown vendor: ${vendor}`);
  }
  return args;
}

// Fixture-mode fetcher: maps a URL to a file in the fixture directory.
function makeFixtureFetcher(dir) {
  return async (url) => {
    const file = urlToFixtureFile(url);
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`fixture not found: ${file}`);
    }
    return fs.readFileSync(filePath, "utf8");
  };
}

function urlToFixtureFile(url) {
  const parsed = new URL(url);
  if (parsed.hostname === "platform.claude.com") return "anthropic.html";
  if (parsed.hostname === "api-docs.deepseek.com") return "deepseek.html";
  if (parsed.hostname === "platform.kimi.ai") return "kimi-models.md";
  if (parsed.hostname === "ai.google.dev") {
    if (parsed.pathname === "/gemini-api/docs/models") return "google-list.html";
    const m = /^\/gemini-api\/docs\/models\/([^/]+)$/.exec(parsed.pathname);
    if (m) return `google-${m[1]}.html`;
  }
  if (parsed.hostname === "docs.bigmodel.cn") {
    if (parsed.pathname === "/cn/guide/models") return "glm-index.html";
    const m = /^\/cn\/guide\/models\/[a-z-]+\/([a-z0-9._-]+)\.md$/.exec(parsed.pathname);
    if (m) return `glm-${m[1]}.md`;
  }
  throw new Error(`no fixture mapping for ${url}`);
}

// The ids a vendor is expected to own, based on the ids already present in
// data/model-info.json. Used by the circuit breaker.
function baselineIds(existing, vendor) {
  const prefixes = VENDORS[vendor].idPrefixes;
  return Object.keys(existing.models ?? {}).filter((id) =>
    prefixes.some((p) => id.startsWith(p)),
  );
}

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const existing = JSON.parse(raw);
  const warnings = [];
  const vendorScrapes = [];
  const report = [];

  const selected = args.only.length > 0 ? args.only : Object.keys(VENDORS);
  const fetcher = args.fromFile ? makeFixtureFetcher(args.fromFile) : (url) => fetchText(url);

  for (const vendor of selected) {
    const { url, parser } = VENDORS[vendor];
    let content;
    try {
      content = await fetcher(url);
    } catch (error) {
      warnings.push(`${vendor}: failed to fetch ${url}: ${error.message}`);
      report.push(`${vendor}: FETCH FAILED (${error.message})`);
      continue;
    }
    const ctx = {
      fetchText: fetcher,
      warn: (message) => warnings.push(`${vendor}: ${message}`),
    };
    let models;
    try {
      models = await parser.parse(content, ctx);
    } catch (error) {
      warnings.push(`${vendor}: parse failed: ${error.message}`);
      report.push(`${vendor}: PARSE FAILED (${error.message})`);
      continue;
    }
    const count = Object.keys(models).length;
    report.push(`${vendor}: ${count} models scraped`);
    vendorScrapes.push({ vendor, models, baselineIds: baselineIds(existing, vendor) });
  }

  for (const [vendor, reason] of Object.entries(MANUAL_VENDORS)) {
    report.push(`${vendor}: manual maintenance (${reason})`);
  }

  const { data, added, modified, keptRetired } = mergeModelInfo(existing, vendorScrapes);

  const changed = added.length > 0 || modified.length > 0;
  if (changed) {
    // Never move the date backwards (UTC date can lag a local updatedAt).
    const today = new Date().toISOString().slice(0, 10);
    data.updatedAt = today > existing.updatedAt ? today : existing.updatedAt;
  }

  let nextRaw = null;
  if (changed) {
    validateModelInfo(data);
    nextRaw = formatModelInfo(data);
  }

  console.log("model-info refresh report");
  for (const line of report) console.log(`  ${line}`);
  console.log(`  added (${added.length}): ${added.join(", ") || "-"}`);
  console.log(`  modified (${modified.length}): ${modified.join(", ") || "-"}`);
  console.log(`  kept retired (${keptRetired.length}): ${keptRetired.join(", ") || "-"}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  console.log(`  updatedAt: ${existing.updatedAt} -> ${changed ? data.updatedAt : existing.updatedAt}${changed ? "" : " (unchanged)"}`);

  if (!changed) {
    console.log("no changes; nothing to do");
    return;
  }
  if (args.dryRun) {
    console.log("dry run: not writing any file");
    return;
  }

  fs.writeFileSync(DATA_FILE, nextRaw);
  run("node", [GENERATOR]);
  console.log(`wrote ${path.relative(ROOT, DATA_FILE)} and regenerated src/model-info-data.ts`);

  if (args.commit) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const branch = `model-info-refresh-${date}`;
    run("git", ["checkout", "-B", branch]);
    run("git", ["add", "data/model-info.json", "src/model-info-data.ts"]);
    const commitMessage = `chore(model-info): refresh model info from official docs\n\nadded: ${added.join(", ")}\nmodified: ${modified.join(", ")}\nkept retired: ${keptRetired.join(", ") || "-"}\n\nwarnings:\n${warnings.map((w) => `- ${w}`).join("\n") || "- none"}`;
    run("git", ["commit", "-m", commitMessage]);
    const prBody = [
      "Automatic refresh of `data/model-info.json` from official model documentation.",
      "",
      `**Added (${added.length})**: ${added.join(", ") || "none"}`,
      `**Modified (${modified.length})**: ${modified.join(", ") || "none"}`,
      `**Kept retired (${keptRetired.length})**: ${keptRetired.join(", ") || "none"}`,
      "",
      "**Warnings**",
      ...(warnings.length > 0 ? warnings.map((w) => `- ${w}`) : ["- none"]),
    ].join("\n");
    run("gh", [
      "pr", "create",
      "--title", `chore(model-info): refresh model info ${date}`,
      "--body", prBody,
    ]);
    console.log(`opened PR on branch ${branch}`);
  }
}

main().catch((error) => {
  console.error(`model-info refresh failed: ${error.message}`);
  process.exit(1);
});
