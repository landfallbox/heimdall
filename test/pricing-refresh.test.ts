import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkPriceDeltas,
  entriesEqual,
  evaluatePricingRisk,
  extractPrices,
  isValidModelId,
  mergePricing,
  validatePriceSanity,
} from "../scripts/pricing-refresh/lib.mjs";

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
          "model-a": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
          "model-b": { currency: "USD", inputPerMillion: 3, cachedInputPerMillion: null, outputPerMillion: 4 },
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
      baselineIds: ["model-a", "model-b"],
      models: {
        "model-b": { currency: "USD", inputPerMillion: 3.5, cachedInputPerMillion: null, outputPerMillion: 4 },
        "model-c": { currency: "USD", inputPerMillion: 5, cachedInputPerMillion: null, outputPerMillion: 6 },
      },
    },
  ]);
  assert.deepEqual(result.added, ["test/model-c"]);
  assert.deepEqual(result.modified, ["test/model-b"]);
  assert.deepEqual(result.keptRetired, ["test/model-a"]);
  assert.deepEqual(result.acceptedVendors, ["test"]);
  assert.ok(result.warnings.some((w) => w.includes("keeping retired models: model-a")));
  assert.equal(result.data.catalogs.test.models["model-a"].outputPerMillion, 2, "retired model must be kept");
  assert.equal(result.data.catalogs.test.models["model-b"].inputPerMillion, 3.5);
  assert.equal(result.data.catalogs.test.models["model-c"].outputPerMillion, 6);
}

{
  // Circuit breaker: empty parse skips the vendor entirely.
  const result = mergePricing(baseData(), [{ vendor: "test", baselineIds: ["model-a", "model-b"], models: {} }]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.modified, []);
  assert.deepEqual(result.acceptedVendors, []);
  assert.ok(result.warnings.some((w) => w.includes("no models parsed")));
  assert.equal(result.data.catalogs.test.models["model-a"].outputPerMillion, 2);
}

{
  // Circuit breaker: model count dropped by more than half skips the vendor.
  const bigBaseline = ["model-a", "model-b", "model-c", "model-d", "model-e", "model-f"];
  const data = baseData();
  for (const id of bigBaseline.slice(2)) {
    data.catalogs.test.models[id] = { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 1 };
  }
  const result = mergePricing(data, [
    { vendor: "test", baselineIds: bigBaseline, models: { "model-a": { currency: "USD", inputPerMillion: 9, cachedInputPerMillion: null, outputPerMillion: 9 } } },
  ]);
  assert.deepEqual(result.modified, []);
  assert.deepEqual(result.acceptedVendors, []);
  assert.ok(result.warnings.some((w) => w.includes("model count dropped")));
  assert.equal(result.data.catalogs.test.models["model-a"].inputPerMillion, 1, "catalog must be untouched");
}

// --- Guardrail Tests: Model ID & Noise Word Filtering ----------------------
{
  assert.equal(isValidModelId("gpt-4o"), true);
  assert.equal(isValidModelId("claude-3-5-sonnet"), true);
  assert.equal(isValidModelId("MiniMax-M3.1-Flash"), true);
  // Noise words
  assert.equal(isValidModelId("pricing"), false);
  assert.equal(isValidModelId("Pricing"), false);
  assert.equal(isValidModelId("overview"), false);
  assert.equal(isValidModelId("documentation"), false);
  assert.equal(isValidModelId("learn-more"), false);
  assert.equal(isValidModelId("contact-us"), false);
  assert.equal(isValidModelId("tokens"), false);
  assert.equal(isValidModelId("input"), false);
  assert.equal(isValidModelId("output"), false);
  assert.equal(isValidModelId("tier"), false);
  assert.equal(isValidModelId("model"), false);
  // Syntax violations
  assert.equal(isValidModelId("a"), false, "length < 2");
  assert.equal(isValidModelId("x".repeat(65)), false, "length > 64");
  assert.equal(isValidModelId("invalid model name"), false, "contains space");
  assert.equal(isValidModelId("invalid\nmodel"), false, "contains newline");
  assert.equal(isValidModelId("模型-gpt"), false, "contains chinese");
  assert.equal(isValidModelId("gpt-4o<br>"), false, "contains html");
  assert.equal(isValidModelId("## gpt-4o"), false, "contains markdown");

  // Rejection during mergePricing
  const mergeResult = mergePricing(baseData(), [
    {
      vendor: "test",
      baselineIds: ["model-a", "model-b"],
      models: {
        "pricing": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
        "valid-model": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
      },
    },
  ]);
  assert.ok(mergeResult.added.includes("test/valid-model"));
  assert.ok(!mergeResult.added.includes("test/pricing"));
  assert.ok(mergeResult.warnings.some((w) => w.includes('rejected invalid or noisy model id "pricing"')));
  console.log("model ID & noise word filtering tests passed");
}

// --- Guardrail Tests: Price Sanity Bounds & Whitelist ----------------------
{
  // Reasonable bounds check: 0.001 ~ 200 USD
  assert.equal(validatePriceSanity(1.5, { currency: "USD", modelId: "model-test" }).valid, true);
  assert.equal(validatePriceSanity(0.0005, { currency: "USD", modelId: "model-test" }).valid, false);
  assert.equal(validatePriceSanity(250, { currency: "USD", modelId: "model-test" }).valid, false);

  // Price cannot be 0 for non-whitelisted models
  const zeroCheck = validatePriceSanity(0, { currency: "USD", modelId: "some-model" });
  assert.equal(zeroCheck.valid, false);
  assert.match(zeroCheck.reason ?? "", /cannot be 0 for non-whitelisted/);

  // Whitelisted zero model allowed
  assert.equal(validatePriceSanity(0, { currency: "CNY", modelId: "sensenova-6.8-flash-lite" }).valid, true);

  // Whitelisted frontier expensive models allowed above 200
  assert.equal(validatePriceSanity(600, { currency: "USD", modelId: "o1-pro" }).valid, true);

  // Merge pricing rejects sanity-violating model
  const sanityMerge = mergePricing(baseData(), [
    {
      vendor: "test",
      baselineIds: ["model-a", "model-b"],
      models: {
        "bad-price-zero": { currency: "USD", inputPerMillion: 0, cachedInputPerMillion: null, outputPerMillion: 1 },
        "bad-price-high": { currency: "USD", inputPerMillion: 5000, cachedInputPerMillion: null, outputPerMillion: 1 },
      },
    },
  ]);
  assert.equal(sanityMerge.added.length, 0);
  assert.ok(sanityMerge.warnings.some((w) => w.includes("rejected price sanity violation")));
  console.log("price sanity bounds & whitelist tests passed");
}

// --- Guardrail Tests: Price Delta Guard (>50% mutation) --------------------
{
  // 25% change: 1.0 -> 1.25, not flagged
  const normalDeltas = checkPriceDeltas(
    { currency: "USD", inputPerMillion: 1.0, outputPerMillion: 2.0 },
    { currency: "USD", inputPerMillion: 1.25, outputPerMillion: 2.0 },
    { vendor: "test", id: "model-a" },
  );
  assert.equal(normalDeltas.length, 0);

  // 75% increase: 1.0 -> 1.75, flagged
  const spikeDeltas = checkPriceDeltas(
    { currency: "USD", inputPerMillion: 1.0, outputPerMillion: 2.0 },
    { currency: "USD", inputPerMillion: 1.75, outputPerMillion: 2.0 },
    { vendor: "test", id: "model-a" },
  );
  assert.equal(spikeDeltas.length, 1);
  assert.equal(spikeDeltas[0].path, "inputPerMillion");
  assert.equal(spikeDeltas[0].ratio, 0.75);

  // 60% drop: 2.0 -> 0.8, flagged
  const dropDeltas = checkPriceDeltas(
    { currency: "USD", inputPerMillion: 1.0, outputPerMillion: 2.0 },
    { currency: "USD", inputPerMillion: 1.0, outputPerMillion: 0.8 },
    { vendor: "test", id: "model-a" },
  );
  assert.equal(dropDeltas.length, 1);
  assert.equal(dropDeltas[0].path, "outputPerMillion");

  // Merge pricing registers delta anomaly and warning
  const deltaMerge = mergePricing(baseData(), [
    {
      vendor: "test",
      baselineIds: ["model-a", "model-b"],
      models: {
        "model-a": { currency: "USD", inputPerMillion: 2.5, cachedInputPerMillion: null, outputPerMillion: 2.0 },
      },
    },
  ]);
  assert.equal(deltaMerge.priceDeltaAnomalies.length, 1);
  assert.ok(deltaMerge.warnings.some((w) => w.includes("price delta on inputPerMillion exceeded 50%")));
  console.log("price delta guard tests passed");
}

// --- Guardrail Tests: Flood Protection Circuit Breaker ---------------------
{
  // Adding > 5 new unknown models for a single vendor triggers flood risk warning
  const floodScrape = {
    vendor: "test",
    baselineIds: ["model-a", "model-b"],
    models: {
      "model-a": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
      "model-new-1": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
      "model-new-2": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
      "model-new-3": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
      "model-new-4": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
      "model-new-5": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
      "model-new-6": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
    },
  };
  const floodResult = mergePricing(baseData(), [floodScrape]);
  assert.ok(floodResult.warnings.some((w) => w.includes("flood risk: abnormally large batch of new models")));
  console.log("flood protection tests passed");
}

// --- Guardrail Tests: Gatekeeper Risk Evaluation ---------------------------
{
  // Green light: clean run, <= 3 added
  const green = evaluatePricingRisk({
    warnings: [],
    fetchErrors: [],
    added: ["test/model-c", "test/model-d"],
    modified: [],
    priceDeltaAnomalies: [],
  });
  assert.equal(green.riskLevel, "green");
  assert.equal(green.isSafeForAutoMerge, true);

  // Yellow light: warnings present
  const yellowWarn = evaluatePricingRisk({
    warnings: ["some minor warning"],
    fetchErrors: [],
    added: [],
    modified: [],
    priceDeltaAnomalies: [],
  });
  assert.equal(yellowWarn.riskLevel, "yellow");
  assert.equal(yellowWarn.isSafeForAutoMerge, false);

  // Yellow light: price mutation > 50%
  const yellowDelta = evaluatePricingRisk({
    warnings: [],
    fetchErrors: [],
    added: [],
    modified: ["test/model-a"],
    priceDeltaAnomalies: [{ vendor: "test", id: "model-a", path: "inputPerMillion", prevVal: 1, nextVal: 2, ratio: 1.0 }],
  });
  assert.equal(yellowDelta.riskLevel, "yellow");
  assert.equal(yellowDelta.isSafeForAutoMerge, false);

  // Yellow light: added models > 3
  const yellowAdded = evaluatePricingRisk({
    warnings: [],
    fetchErrors: [],
    added: ["a/1", "a/2", "a/3", "a/4"],
    modified: [],
    priceDeltaAnomalies: [],
  });
  assert.equal(yellowAdded.riskLevel, "yellow");
  assert.equal(yellowAdded.isSafeForAutoMerge, false);

  // Red light: fetch error
  const redError = evaluatePricingRisk({
    warnings: [],
    fetchErrors: ["network timeout"],
    added: [],
    modified: [],
    priceDeltaAnomalies: [],
  });
  assert.equal(redError.riskLevel, "red");
  assert.equal(redError.isSafeForAutoMerge, false);

  // Red light: flood risk warning
  const redFlood = evaluatePricingRisk({
    warnings: ["test: flood risk: abnormally large batch"],
    fetchErrors: [],
    added: [],
    modified: [],
    priceDeltaAnomalies: [],
  });
  assert.equal(redFlood.riskLevel, "red");
  assert.equal(redFlood.isSafeForAutoMerge, false);
  console.log("gatekeeper risk evaluation tests passed");
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
