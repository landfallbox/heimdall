import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeModelInfo } from "../scripts/model-info-refresh/lib.mjs";
import * as anthropic from "../scripts/model-info-refresh/parsers/anthropic.mjs";
import * as deepseek from "../scripts/model-info-refresh/parsers/deepseek.mjs";
import * as glm from "../scripts/model-info-refresh/parsers/glm.mjs";
import * as google from "../scripts/model-info-refresh/parsers/google.mjs";
import * as kimi from "../scripts/model-info-refresh/parsers/kimi.mjs";

const FIXTURES = new URL("./fixtures/model-info/", import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIXTURES), "utf8");

// .mjs parsers are typed as returning {}; narrow the results here.
type ScrapedModel = {
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: Record<string, boolean>;
};
type ScrapedModels = Record<string, ScrapedModel>;

// --- anthropic parser ---
{
  const models = (await anthropic.parse(fixture("anthropic.html"))) as ScrapedModels;
  const expected = ["claude-fable-5-1", "claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"];
  assert.deepEqual(Object.keys(models).sort(), expected);
  for (const id of expected) {
    assert.equal(models[id].contextWindow, 1048576);
    assert.equal(models[id].maxOutputTokens, 131072);
    assert.deepEqual(models[id].capabilities, { thinking: true });
  }
}

// --- deepseek parser ---
{
  const models = (await deepseek.parse(fixture("deepseek.html"))) as ScrapedModels;
  assert.deepEqual(Object.keys(models).sort(), ["deepseek-flash", "deepseek-v4-pro"]);
  for (const id of ["deepseek-flash", "deepseek-v4-pro"]) {
    assert.equal(models[id].contextWindow, 1048576);
    assert.equal(models[id].maxOutputTokens, 393216);
  }
  // Vision is per-model in the fixture: flash supports it, v4-pro does not.
  assert.deepEqual(models["deepseek-flash"].capabilities, { thinking: true, toolCalling: true, vision: true });
  assert.deepEqual(models["deepseek-v4-pro"].capabilities, { thinking: true, toolCalling: true, vision: false });
}

// --- google parser (list + detail, fixture-backed fetch) ---
{
  const listIds = google.extractListIds(fixture("google-list.html"));
  assert.ok(listIds.includes("gemini-2.5-pro"));
  assert.ok(!listIds.some((id) => id.includes("Shut down")));
  // No duplicate ids.
  assert.equal(new Set(listIds).size, listIds.length);

  const detail = google.parseDetail(fixture("google-gemini-2.5-pro.html")) as ScrapedModel;
  assert.equal(detail.contextWindow, 1048576);
  assert.equal(detail.maxOutputTokens, 65536);
  assert.deepEqual(detail.capabilities, { vision: true, toolCalling: true, thinking: true });

  const warnings: string[] = [];
  const models = await google.parse(fixture("google-list.html"), {
    fetchText: async (url: string) => {
      const id = new URL(url).pathname.split("/").pop();
      return fixture(`google-${id}.html`);
    },
    warn: (message: string) => warnings.push(message),
  }) as ScrapedModels;
  // Only gemini-2.5-pro has a detail fixture; the rest warn and are skipped.
  assert.equal(Object.keys(models).length, 1);
  assert.equal(models["gemini-2.5-pro"].contextWindow, 1048576);
  assert.equal(warnings.length, listIds.length - 1);
}

// --- kimi parser ---
{
  const models = (await kimi.parse(fixture("kimi-models.md"))) as ScrapedModels;
  assert.deepEqual(Object.keys(models).sort(), [
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k2.7-code-highspeed",
    "kimi-k3",
    "kimi-k3.1-pro",
    "kimi-k3.1-pro-highspeed",
  ]);
  assert.equal(models["kimi-k3.1-pro"].contextWindow, 1048576);
  assert.deepEqual(models["kimi-k3.1-pro"].capabilities, { vision: true });
  assert.deepEqual(models["kimi-k3.1-pro-highspeed"], {});
  assert.equal(models["kimi-k3"].contextWindow, 1048576);
  assert.deepEqual(models["kimi-k3"].capabilities, { vision: true });
  assert.equal(models["kimi-k2.7-code"].contextWindow, 262144);
  assert.equal("capabilities" in models["kimi-k2.7-code"], false);
  assert.deepEqual(models["kimi-k2.7-code-highspeed"], {});
  assert.equal(models["kimi-k2.6"].contextWindow, 262144);
  assert.deepEqual(models["kimi-k2.6"].capabilities, { vision: true, thinking: true });
  // Deprecated models must not appear.
  assert.equal("kimi-k2.5" in models, false);
  assert.equal("moonshot-v1-8k" in models, false);
}

// --- glm parser (index + detail, fixture-backed fetch) ---
{
  const warnings: string[] = [];
  const models = await glm.parse(fixture("glm-index.html"), {
    fetchText: async (url: string) => {
      const file = `glm-${new URL(url).pathname.split("/").pop()?.replace(/\.md$/, "")}.md`;
      return fixture(file);
    },
    warn: (message: string) => warnings.push(message),
  }) as ScrapedModels;
  // Only glm-5.3-flash has a fixture; the other four detail pages fail and warn.
  assert.equal(warnings.length, 4);
  assert.deepEqual(Object.keys(models).sort(), ["glm-5.3-flash", "glm-5.3-flashx", "glm-5.3-flashx-legal"]);
  for (const id of Object.keys(models)) {
    assert.equal(models[id].contextWindow, 1048576);
    assert.equal(models[id].maxOutputTokens, 131072);
    assert.deepEqual(models[id].capabilities, { thinking: true, toolCalling: true, vision: true });
  }
}

// --- merge semantics ---
{
  const existing = {
    schemaVersion: 1,
    updatedAt: "2026-01-01",
    models: {
      "claude-3-5-sonnet": {
        displayName: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        capabilities: { toolCalling: true },
        supportsReasoningEffort: ["low", "high"],
      },
      "gpt-4o": { displayName: "GPT-4o", contextWindow: 128000 },
    },
  };

  // Adds new models, modifies changed ones, never deletes, never touches
  // manual-only fields.
  const { data, added, modified, keptRetired, warnings } = mergeModelInfo(existing, [
    {
      vendor: "anthropic",
      baselineIds: ["claude-3-5-sonnet"],
      models: {
        "claude-3-5-sonnet": {
          contextWindow: 1000000,
          capabilities: { toolCalling: true, thinking: true, displayName: "hacked" },
        },
        "claude-opus-5-5": { contextWindow: 1000000 },
      },
    },
    {
      vendor: "openai",
      baselineIds: ["gpt-4o"],
      models: {
        "gpt-4o": { contextWindow: 128000 },
      },
    },
  ]);
  assert.deepEqual(added, ["claude-opus-5-5"]);
  assert.deepEqual(modified, ["claude-3-5-sonnet"]);
  assert.equal(keptRetired.length, 0);
  assert.equal(warnings.length, 0);
  assert.equal(data.models["claude-3-5-sonnet"].contextWindow, 1000000);
  assert.deepEqual(data.models["claude-3-5-sonnet"].capabilities, { toolCalling: true, thinking: true });
  // Manual-only fields survive untouched.
  assert.equal(data.models["claude-3-5-sonnet"].displayName, "Claude 3.5 Sonnet");
  assert.deepEqual(data.models["claude-3-5-sonnet"].supportsReasoningEffort, ["low", "high"]);
  // Unscraped vendor models are never deleted.
  assert.ok(data.models["gpt-4o"]);

  // Circuit breaker: zero parsed models -> vendor skipped, nothing merged.
  const zero = mergeModelInfo(existing, [{ vendor: "anthropic", baselineIds: ["claude-3-5-sonnet"], models: {} }]);
  assert.equal(zero.added.length, 0);
  assert.equal(zero.modified.length, 0);
  assert.match(zero.warnings[0], /no models parsed/);
  assert.equal(zero.data.models["claude-3-5-sonnet"].contextWindow, 200000);

  // Circuit breaker: more than half of the baseline missing -> vendor skipped.
  const drop = mergeModelInfo(existing, [
    { vendor: "anthropic", baselineIds: ["claude-3-5-sonnet", "claude-3-opus", "claude-3-haiku"], models: { "claude-3-5-sonnet": { contextWindow: 1 } } },
  ]);
  assert.equal(drop.modified.length, 0);
  assert.match(drop.warnings[0], /model count dropped from 3 to 1/);

  // Retired models are kept and reported.
  const retired = mergeModelInfo(existing, [
    { vendor: "anthropic", baselineIds: ["claude-3-5-sonnet"], models: { "claude-opus-5-5": { contextWindow: 1 } } },
  ]);
  assert.deepEqual(retired.keptRetired, ["claude-3-5-sonnet"]);
  assert.match(retired.warnings[0], /keeping retired models: claude-3-5-sonnet/);
  assert.ok(retired.data.models["claude-3-5-sonnet"]);
}

// --- CLI dry run against fixtures (no network, no writes) ---
{
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataFile = path.join(root, "data/model-info.json");
  const before = readFileSync(dataFile, "utf8");
  const output = execFileSync(
    process.execPath,
    [path.join("scripts", "model-info-refresh", "refresh-model-info.mjs"), "--from-file", path.join("test", "fixtures", "model-info"), "--dry-run"],
    { cwd: root, encoding: "utf8" },
  );
  assert.match(output, /anthropic: 4 models scraped/);
  assert.match(output, /deepseek: 2 models scraped/);
  assert.match(output, /google: \d+ models scraped/);
  assert.match(output, /kimi: 6 models scraped/);
  assert.match(output, /glm: 3 models scraped/);
  assert.match(output, /openai: manual maintenance/);
  assert.match(output, /mimo: manual maintenance/);
  assert.match(output, /added \(\d+\):/);
  assert.match(output, /dry run: not writing any file/);
  // Dry run must not touch the data file.
  assert.equal(readFileSync(dataFile, "utf8"), before);
}
