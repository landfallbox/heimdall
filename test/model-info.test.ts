import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILTIN_MODEL_INFO_DATA } from "../src/model-info-data.ts";
import {
  MODEL_INFO,
  applyModelInfo,
  getModelInfo,
  getModelInfoUpdatedAt,
  type ModelInfo,
  type RemoteModelInfoData,
} from "../src/model-info.ts";
import { parseRemoteModelInfo } from "../src/model-info-updater.ts";

// The published file must parse and stay in sync with the generated fallback.
const source = JSON.parse(readFileSync(new URL("../data/model-info.json", import.meta.url), "utf8"));
assert.equal(source.schemaVersion, 1);
assert.deepEqual(parseRemoteModelInfo(source), BUILTIN_MODEL_INFO_DATA);

// --- getModelInfo ---
assert.equal(getModelInfo(""), null);
assert.equal(getModelInfo("   "), null);
assert.equal(getModelInfo("no-such-model"), null);

const gpt4o = getModelInfo("gpt-4o");
assert.ok(gpt4o);
assert.equal(gpt4o.displayName, "GPT-4o");
assert.equal(gpt4o.contextWindow, 128000);
assert.equal(gpt4o.maxOutputTokens, 16384);
assert.deepEqual(gpt4o.capabilities, { toolCalling: true, vision: true, thinking: false });

// Case-insensitive fallback lookup.
assert.equal(getModelInfo("GPT-4O")?.displayName, "GPT-4o");

// Partial entries must be tolerated: a model with only a display name.
function remoteData(updatedAt: string): RemoteModelInfoData {
  return {
    schemaVersion: 1,
    updatedAt,
    models: {
      "gpt-4o": { displayName: "GPT-4o (updated)" },
      "brand-new-model": {
        contextWindow: 500000,
        maxOutputTokens: 128000,
        capabilities: { toolCalling: true, vision: true, thinking: true },
        supportsReasoningEffort: ["low", "medium", "high"],
      },
    },
  };
}

// --- applyModelInfo merge semantics ---
const before = { ...MODEL_INFO.models["gpt-4o"] } as ModelInfo;
const result = applyModelInfo(remoteData("2099-01-01"));
assert.equal(result.applied, 2);
assert.equal(result.updatedAt, "2099-01-01");
assert.equal(getModelInfoUpdatedAt(), "2099-01-01");

// Remote wins per model, but only for the fields it provides (merge, not replace).
const merged = getModelInfo("gpt-4o")!;
assert.equal(merged.displayName, "GPT-4o (updated)");
assert.equal(merged.contextWindow, before.contextWindow);
assert.equal(merged.maxOutputTokens, before.maxOutputTokens);

// New models are added.
const fresh = getModelInfo("brand-new-model")!;
assert.equal(fresh.contextWindow, 500000);
assert.deepEqual(fresh.supportsReasoningEffort, ["low", "medium", "high"]);

// Built-in entries are never removed.
assert.ok(getModelInfo("deepseek-chat"));

// Invalid payloads must not corrupt the in-memory record.
assert.throws(() => parseRemoteModelInfo({ schemaVersion: 2, updatedAt: "x", models: {} }));
assert.throws(() => parseRemoteModelInfo({ schemaVersion: 1, updatedAt: "x", models: { bad: { contextWindow: -1 } } }));
assert.throws(() => parseRemoteModelInfo({ schemaVersion: 1, updatedAt: "x", models: { bad: { surprise: true } } }));
assert.throws(() => parseRemoteModelInfo({ schemaVersion: 1, updatedAt: "x", models: { bad: { supportsReasoningEffort: ["bogus"] } } }));

console.log("model-info.test.ts passed");
