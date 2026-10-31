import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { entriesEqual, mergePricing } from "../scripts/pricing-refresh/lib.mjs";

type ScrapedEntry = {
  currency: string;
  inputPerMillion: number;
  cachedInputPerMillion?: number | null;
  outputPerMillion: number;
  [key: string]: unknown;
};
type ScrapedModels = Record<string, ScrapedEntry>;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDir = join(root, "test", "fixtures", "pricing");
const cliPath = join(root, "scripts", "pricing-refresh", "refresh-pricing.mjs");
const catalog = JSON.parse(readFileSync(join(root, "data", "pricing.json"), "utf8"));

const tempDir = mkdtempSync(join(tmpdir(), "heimdall-pricing-refresh-test-"));

// Vendors with a real page fixture: every catalog model must be scraped with
// an identical entry, and no bogus model may be added.
const REAL_FIXTURE_VENDORS = ["deepseek", "glm", "kimi", "mimo", "minimax", "stepfun", "qwen", "openai", "google", "anthropic", "sensenova"] as const;

// Models that are intentionally kept in the catalog after being removed from
// the official page (retired, kept by design — see plan §3.2).
const KNOWN_RETIRED = new Set([
  "kimi-k2.5",
  "kimi-k2",
  "mimo-v2.5-pro",
  "mimo-v2.5",
  // glm-4.6v is a vision model listed only in the page's blockquote "更多视觉模型"
  // section, which the parser skips by design.
  "glm-4.6v",
  // The six anthropic dot aliases (claude-opus-4.6 etc.) are kept in the catalog by design; the live page only lists hyphen slugs, so they are skipped here.
  "claude-opus-4.6",
  "claude-opus-4.5",
  "claude-opus-4.1",
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-haiku-4.5",
  // SenseNova 6.8 Flash Lite is a free Preview model not listed on the public
  // pricing page; it is a hand-written catalog entry, so the round-trip skips it.
  "sensenova-6.8-flash-lite",
  // deepseek-v4-flash is a retired legacy name (official page footnote: still
  // accepted, served by DeepSeek-V4.1-Flash-1017 and billed at the Flash
  // price). It is no longer listed in the page's MODEL row, so the hand-written
  // catalog entry is skipped by the round-trip.
  "deepseek-v4-flash",
  // deepseek-v4.1-flash is a hand-written entry (non-official API id kept for
  // upstream gateway compatibility); it is not listed on the official page, so
  // the round-trip skips it.
  "deepseek-v4.1-flash",
]);

async function loadParser(vendor: string) {
  const mod = await import(`../scripts/pricing-refresh/parsers/${vendor}.mjs`);
  return mod.parse;
}

for (const vendor of REAL_FIXTURE_VENDORS) {
  const fixture = {
    deepseek: "deepseek.html",
    glm: "glm-pricing.md",
    kimi: "kimi-pricing.html",
    mimo: "mimo-pricing.md",
    minimax: "minimax-pricing.html",
    stepfun: "stepfun-pricing.md",
    qwen: "qwen-pricing.html",
    openai: "openai-pricing.html",
    google: "google-pricing.html",
    anthropic: "anthropic-pricing.html",
    sensenova: "sensenova-pricing.html",
  }[vendor];
  const parse = await loadParser(vendor);
  const models = (await parse(readFileSync(join(fixtureDir, fixture), "utf8"), vendor === "google" ? { now: new Date(2026, 9, 27) } : undefined)) as ScrapedModels;
  const expected = catalog.catalogs[vendor].models;

  assert.ok(Object.keys(models).length > 0, `${vendor}: parser returned no models`);
  for (const [id, entry] of Object.entries(expected)) {
    if (KNOWN_RETIRED.has(id)) continue; // kept in catalog by design
    assert.ok(models[id], `${vendor}: missing catalog model ${id}`);
    assert.ok(entriesEqual(models[id], entry), `${vendor}/${id} differs from catalog:\nscraped: ${JSON.stringify(models[id])}\ncatalog: ${JSON.stringify(entry)}`);
  }
  // New models found on the page are legitimate additions (they land in the
  // PR for human review); only reject malformed entries.
  const currency = ["kimi", "openai", "google", "anthropic"].includes(vendor) ? "USD" : "CNY";
  for (const [id, entry] of Object.entries(models)) {
    if (expected[id] === undefined) {
      assert.equal(entry.currency, currency, `${vendor}/${id}: unexpected currency`);
      assert.ok(typeof entry.inputPerMillion === "number", `${vendor}/${id}: malformed entry`);
      console.log(`${vendor}: new model on page: ${id}`);
    }
  }
  console.log(`${vendor}: ${Object.keys(models).length} models parsed`);
}

// --- sensenova parser edge cases --------------------------------------------

{
  // Synthetic rows: duplicate ID (first valid row wins), a 5-col row with an
  // empty trailing output cell whose label covers both directions (single-price
  // fallback), a separate-label row with a blank output cell (skipped, not
  // back-filled), and a populated free output value (still rejected).
  const parse = await loadParser("sensenova");
  const html = `<table>
    <tr><td>服务</td><td>计费项</td><td>单价</td><td>计费项</td><td>单价</td></tr>
    <tr><td>SenseNova-Test-A模型调用</td><td>输入tokens</td><td>0.003元/千tokens</td><td>输出tokens</td><td>0.009元/千tokens</td></tr>
    <tr><td>SenseNova-Test-B模型调用</td><td>输入tokens、输出tokens</td><td>0.015元/千tokens</td><td></td><td></td></tr>
    <tr><td>SenseNova-Test-A模型调用</td><td>输入tokens</td><td>0.999元/千tokens</td><td>输出tokens</td><td>0.999元/千tokens</td></tr>
    <tr><td>SenseNova-Test-C模型调用</td><td>输入tokens</td><td>0.001元/千tokens</td><td>输出tokens</td><td>限时免费体验</td></tr>
    <tr><td>SenseNova-Test-D模型调用</td><td>输入tokens</td><td>0.002元/千tokens</td><td>输出tokens</td><td></td></tr>
  </table>`;
  const models = (await parse(html)) as ScrapedModels;
  assert.deepEqual(models["sensenova-test-a"], {
    currency: "CNY",
    inputPerMillion: 3,
    cachedInputPerMillion: null,
    outputPerMillion: 9,
  });
  assert.deepEqual(models["sensenova-test-b"], {
    currency: "CNY",
    inputPerMillion: 15,
    cachedInputPerMillion: null,
    outputPerMillion: 15,
  });
  assert.equal(models["sensenova-test-c"], undefined, "free output value must be rejected");
  assert.equal(
    models["sensenova-test-d"],
    undefined,
    "separate-label row with a blank output cell must not be back-filled with the input price",
  );
  console.log("sensenova parser: duplicate + shared-price fallback handling works");
}

// --- merge semantics -------------------------------------------------------

function baseData(): {
  schemaVersion: number;
  updatedAt: string;
  catalogs: Record<string, { sourceUrl: string; updatedAt: string; models: Record<string, ScrapedEntry> }>;
} {
  return {
    schemaVersion: 1,
    updatedAt: "2026-01-01",
    catalogs: {
      test: {
        sourceUrl: "https://example.com",
        updatedAt: "2026-01-01",
        models: {
          "a": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
          "b": { currency: "USD", inputPerMillion: 3, cachedInputPerMillion: null, outputPerMillion: 4 },
        },
      },
    },
  };
}

{
  // Modify one, keep one, add one, keep a retired model with a warning.
  const result = mergePricing(baseData(), [
    {
      vendor: "test",
      baselineIds: ["a", "b"],
      models: {
        b: { currency: "USD", inputPerMillion: 3.5, cachedInputPerMillion: null, outputPerMillion: 4 },
        c: { currency: "USD", inputPerMillion: 5, cachedInputPerMillion: null, outputPerMillion: 6 },
      },
    },
  ]);
  assert.deepEqual(result.added, ["test/c"]);
  assert.deepEqual(result.modified, ["test/b"]);
  assert.deepEqual(result.keptRetired, ["test/a"]);
  assert.ok(result.warnings.some((w) => w.includes("keeping retired models: a")));
  assert.equal(result.data.catalogs.test.models["a"].outputPerMillion, 2, "retired model must be kept");
  assert.equal(result.data.catalogs.test.models["b"].inputPerMillion, 3.5);
  assert.equal(result.data.catalogs.test.models["c"].outputPerMillion, 6);
}

{
  // Circuit breaker: empty parse skips the vendor entirely.
  const result = mergePricing(baseData(), [{ vendor: "test", baselineIds: ["a", "b"], models: {} }]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.modified, []);
  assert.ok(result.warnings.some((w) => w.includes("no models parsed")));
  assert.equal(result.data.catalogs.test.models["a"].outputPerMillion, 2);
}

{
  // Circuit breaker: model count dropped by more than half skips the vendor.
  const bigBaseline = ["a", "b", "c", "d", "e", "f"];
  const data = baseData();
  for (const id of bigBaseline.slice(2)) {
    data.catalogs.test.models[id] = { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 1 };
  }
  const result = mergePricing(data, [
    { vendor: "test", baselineIds: bigBaseline, models: { a: { currency: "USD", inputPerMillion: 9, cachedInputPerMillion: null, outputPerMillion: 9 } } },
  ]);
  assert.deepEqual(result.modified, []);
  assert.ok(result.warnings.some((w) => w.includes("model count dropped")));
  assert.equal(result.data.catalogs.test.models["a"].inputPerMillion, 1, "catalog must be untouched");
}

// --- CLI dry-run (offline, via --from-file and --data-file) ----------------

{
  // A data copy where qwen3.8-max was "changed" must report a modification.
  const dataCopy = join(tempDir, "pricing.json");
  copyFileSync(join(root, "data", "pricing.json"), dataCopy);
  const changed = JSON.parse(readFileSync(dataCopy, "utf8"));
  changed.catalogs.qwen.models["qwen3.8-max"] = {
    ...changed.catalogs.qwen.models["qwen3.8-max"],
    inputPerMillion: 99,
  };
  changed.catalogs.qwen.models["qwen3.8-max"].pricing = {
    ...changed.catalogs.qwen.models["qwen3.8-max"].pricing,
    inputPerMillion: 99,
  };
  for (const tier of changed.catalogs.qwen.models["qwen3.8-max"].tiers ?? []) {
    if (tier.isBase) tier.inputPerMillion = 99;
  }
  writeFileSync(dataCopy, JSON.stringify(changed, null, 2) + "\n");

  const out = execFileSync(
    process.execPath,
    [cliPath, "--only", "qwen", "--from-file", join(fixtureDir, "qwen-pricing.html"), "--data-file", dataCopy, "--dry-run"],
    { cwd: root, encoding: "utf8" },
  );
  assert.ok(out.includes("modified: qwen/qwen3.8-max"), `expected qwen3.8-max in modified list:\n${out}`);
  assert.ok(out.includes("dry-run: would update"), `expected dry-run notice:\n${out}`);
  // dry-run must not touch the data file
  const untouched = JSON.parse(readFileSync(dataCopy, "utf8"));
  assert.equal(untouched.catalogs.qwen.models["qwen3.8-max"].inputPerMillion, 99, "dry-run must not write");
  console.log("cli dry-run: modified detection works");
}

rmSync(tempDir, { recursive: true, force: true });
console.log("pricing-refresh tests passed");
