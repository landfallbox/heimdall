import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeConfig } from "../src/config.ts";
import {
  VSCODE_PROVIDER_NAME,
  buildVsCodeModelEntries,
  mergeVsCodeModelsFile,
  resolveVsCodeModelsFilePath,
  syncVsCodeModels,
} from "../src/vscode-sync.ts";

// --- resolveVsCodeModelsFilePath -------------------------------------------
assert.equal(
  resolveVsCodeModelsFilePath({ HEIMDALL_VSCODE_MODELS_FILE: "C:\\custom\\file.json" } as any),
  "C:\\custom\\file.json",
);
// The override wins even when it looks like a relative path.
assert.equal(
  resolveVsCodeModelsFilePath({ HEIMDALL_VSCODE_MODELS_FILE: "  ./models.json  " } as any),
  "./models.json",
);
// On Windows the APPDATA location is used when no override is present.
if (process.platform === "win32") {
  assert.equal(
    resolveVsCodeModelsFilePath({ APPDATA: "C:\\Users\\tester\\AppData\\Roaming" } as any),
    "C:\\Users\\tester\\AppData\\Roaming\\Code\\User\\chatLanguageModels.json",
  );
}

// --- buildVsCodeModelEntries -----------------------------------------------
const config = normalizeConfig({
  router: { apiKey: "test-token", port: 4000 },
  vendors: [
    {
      name: "local",
      baseUrl: "http://127.0.0.1:8000/v1",
      models: [
        { id: "model-a", enabled: true },
        { id: "model-b", enabled: true, vscode: { name: "Model B", toolCalling: true, contextWindow: 128000 } },
        { id: "model-c", enabled: false },
      ],
    },
    {
      name: "disabled-vendor",
      baseUrl: "http://127.0.0.1:8001/v1",
      enabled: false,
      models: [{ id: "model-d", enabled: true }],
    },
    {
      name: "dup",
      baseUrl: "http://127.0.0.1:8002/v1",
      models: [{ id: "model-a", enabled: true }],
    },
  ],
});

const entries = buildVsCodeModelEntries(config);
assert.equal(entries.length, 2, "disabled vendor/model and duplicates are skipped");
// Only metadata the user filled in is emitted. Checked before deepEqual below,
// which narrows the entries to their literal shape.
assert.equal(entries[0].name, undefined);
assert.equal(entries[1].vision, undefined);
assert.equal(entries[1].maxOutputTokens, undefined);
assert.deepEqual(entries[0], { id: "model-a", wireModel: "model-a", url: "http://127.0.0.1:4000/v1" });
assert.deepEqual(entries[1], {
  id: "model-b",
  wireModel: "model-b",
  url: "http://127.0.0.1:4000/v1",
  name: "Model B",
  toolCalling: true,
  contextWindow: 128000,
});

// --- mergeVsCodeModelsFile --------------------------------------------------
// 1. No existing file: provider is created and seeded with the API key.
const created = mergeVsCodeModelsFile(null, entries, { apiKey: "test-token" });
assert.equal(created.createdProvider, true);
assert.equal(created.providers.length, 1);
assert.equal(created.providers[0]!.name, VSCODE_PROVIDER_NAME);
assert.equal(created.providers[0]!.vendor, "customendpoint");
assert.equal(created.providers[0]!.apiType, "chat-completions");
assert.equal(created.providers[0]!.apiKey, "test-token");
assert.equal((created.providers[0]!.models as any[]).length, 2);
// A brand-new model without a name falls back to its id.
assert.equal((created.providers[0]!.models as any[])[0]!.name, "model-a");

// 2. Other providers are preserved verbatim and the Heimdall provider is merged in.
const otherProvider = { name: "Copilot", vendor: "agent-host-copilotcli", models: [{ id: "x" }] };
const existingFile = [otherProvider, {
  name: VSCODE_PROVIDER_NAME,
  vendor: "customendpoint",
  apiType: "chat-completions",
  apiKey: "${input:chat.lm.secret.abc123}",
  settings: { "customendpoint/Heimdall/model-a": { thinkingLevel: "high" } },
  models: [
    { id: "model-b", name: "Renamed B", toolCalling: true, contextWindow: 999999, extra: "keep-me" },
    { id: "stale-model", name: "Stale" },
  ],
}];
const merged = mergeVsCodeModelsFile(existingFile, entries, { apiKey: "test-token" });
assert.equal(merged.createdProvider, false);
assert.equal(merged.providers.length, 2);
assert.deepEqual(merged.providers[0], otherProvider, "other providers are untouched");
const heimdall = merged.providers[1]!;
// The secret reference is never replaced.
assert.equal(heimdall.apiKey, "${input:chat.lm.secret.abc123}");
// Provider-level settings are preserved.
assert.deepEqual(heimdall.settings, { "customendpoint/Heimdall/model-a": { thinkingLevel: "high" } });
const mergedModels = heimdall.models as any[];
assert.equal(mergedModels.length, 2, "stale model is dropped");
const mergedA = mergedModels.find((m) => m.id === "model-a")!;
const mergedB = mergedModels.find((m) => m.id === "model-b")!;
// model-a is new in this run: name falls back to id.
assert.equal(mergedA.name, "model-a");
assert.equal(mergedA.url, "http://127.0.0.1:4000/v1");
// model-b already existed: heimdall fields override, unknown fields are kept.
assert.equal(mergedB.name, "Model B", "heimdall-provided name wins");
assert.equal(mergedB.contextWindow, 128000, "heimdall-provided contextWindow wins");
assert.equal(mergedB.extra, "keep-me", "unknown fields are preserved");

// 3. A plain (non-secret) apiKey is updated, but a secret reference is not.
const plainKey = mergeVsCodeModelsFile([
  { name: VSCODE_PROVIDER_NAME, models: [], apiKey: "old-plain-key" },
], [], { apiKey: "new-plain-key" });
assert.equal(plainKey.providers[0]!.apiKey, "new-plain-key");
const secretKey = mergeVsCodeModelsFile([
  { name: VSCODE_PROVIDER_NAME, models: [], apiKey: "${input:chat.lm.secret.zzz}" },
], [], { apiKey: "should-not-apply" });
assert.equal(secretKey.providers[0]!.apiKey, "${input:chat.lm.secret.zzz}");

// 4. A non-array top level is rejected.
assert.throws(() => mergeVsCodeModelsFile({ not: "an array" }, entries));

// --- syncVsCodeModels (read/merge/write round-trip) -------------------------
const tempDirectory = mkdtempSync(join(tmpdir(), "heimdall-vscode-sync-test-"));
const vsCodeFile = join(tempDirectory, "chatLanguageModels.json");
try {
  const first = await syncVsCodeModels(config, { filePath: vsCodeFile });
  assert.equal(first.ok, true, first.error ?? "unexpected sync failure");
  assert.equal(first.createdProvider, true);
  assert.equal(first.modelCount, 2);
  assert.ok(readFileSync(vsCodeFile, "utf8").length > 0);

  // A second sync merges with what was written and does not create the provider again.
  const second = await syncVsCodeModels(config, { filePath: vsCodeFile });
  assert.equal(second.ok, true, second.error ?? "unexpected sync failure");
  assert.equal(second.createdProvider, false);
  assert.equal(second.modelCount, 2);
  const written = JSON.parse(readFileSync(vsCodeFile, "utf8"));
  assert.equal(written.length, 1);
  assert.equal(written[0].name, VSCODE_PROVIDER_NAME);
  assert.equal((written[0].models as any[]).length, 2);

  // A malformed file produces a structured failure instead of throwing.
  writeFileSync(vsCodeFile, "{ this is not json", "utf8");
  const failed = await syncVsCodeModels(config, { filePath: vsCodeFile });
  assert.equal(failed.ok, false);
  assert.ok(failed.error);
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

console.log("vscode sync tests passed");
