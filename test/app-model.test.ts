import assert from "node:assert/strict";
import {
  applyModelSwitch,
  canLoadVendorModels,
  cloneVendor,
  endpointsFromDraft,
  formatLogTime,
  formatUserErrorMessage,
  getVendorModelOptions,
  getVendorModelsErrorField,
  getVendorModelsLoadMessage,
  getVendorModelsSourceKey,
  isValidCustomPricing,
  parseLogRows,
  validateRouter,
  validateVendor,
  validateVendorBaseUrl,
} from "../gui/src/app-model.ts";
import type { Draft, VendorDraft, VendorModelDraft } from "../gui/src/config-draft.ts";
import type { ModelInfo } from "../src/model-info.ts";

assert.equal(validateVendorBaseUrl(""), "Base URL is required.");
assert.equal(validateVendorBaseUrl("ftp://example.com"), "Base URL must start with http:// or https://.");
assert.equal(validateVendorBaseUrl("http://127.0.0.1:8000/v1"), "");
assert.equal(validateVendorBaseUrl("https://api.example.com"), "");
assert.match(validateVendorBaseUrl("not a url"), /must start with http/);
assert.match(validateVendorBaseUrl("http://"), /valid URL/);

const baseRouter = { host: "127.0.0.1", port: 4000 } as unknown as Draft["router"];
assert.equal(validateRouter(baseRouter).hasErrors, false);
assert.equal(validateRouter({ ...baseRouter, port: 0 } as unknown as Draft["router"]).hasErrors, true);
assert.equal(validateRouter({ ...baseRouter, port: "abc" } as unknown as Draft["router"]).hasErrors, true);
assert.match(validateRouter({ ...baseRouter, port: 99999 } as unknown as Draft["router"]).firstError!, /between 1 and 65535/);

assert.equal(endpointsFromDraft({ router: { host: "127.0.0.1", port: 4000 } } as unknown as Draft).chatCompletions, "http://127.0.0.1:4000/v1/chat/completions");
assert.equal(endpointsFromDraft({ router: { host: "127.0.0.1", port: 4000 } } as unknown as Draft).responses, "http://127.0.0.1:4000/v1/responses");
assert.equal(endpointsFromDraft({ router: { host: "::1", port: 4100 } } as unknown as Draft).chatCompletions, "http://[::1]:4100/v1/chat/completions");

const validVendor = {
  name: "V",
  baseUrl: "http://127.0.0.1:9000/v1",
  models: [{ id: "m1", enabled: true }],
  authentication: "none",
} as VendorDraft;
assert.equal(validateVendor(validVendor).hasErrors, false);
assert.equal(validateVendor(null).hasErrors, true);
assert.equal(validateVendor({ ...validVendor, name: "" } as VendorDraft).hasErrors, true);
assert.equal(validateVendor({ ...validVendor, models: [{ id: "m1", enabled: true }, { id: "m1", enabled: true }] } as VendorDraft).hasErrors, true);
const needKey = validateVendor({ ...validVendor, authentication: "api-key", apiKey: "" } as VendorDraft);
assert.equal(needKey.hasErrors, true);
assert.match(needKey.fields.apiKey?.message!, /API key/);

assert.equal(getVendorModelsLoadMessage(validVendor), "");
assert.equal(canLoadVendorModels(validVendor), true);
assert.equal(canLoadVendorModels({ ...validVendor, authentication: "api-key", apiKey: "" } as VendorDraft), false);
assert.match(getVendorModelsLoadMessage({ ...validVendor, authentication: "api-key", apiKey: "" } as VendorDraft), /API key/);

assert.deepEqual(getVendorModelOptions(validVendor, ["extra"]), ["extra", "m1"]);
assert.equal(getVendorModelsSourceKey(validVendor as never), "http://127.0.0.1:9000/v1");
assert.equal(getVendorModelsSourceKey(null), "");

const cloned = cloneVendor(validVendor)!;
assert.deepEqual(cloned, validVendor);
cloned.name = "changed";
assert.equal(validVendor.name, "V");
assert.equal(cloneVendor(null), null);

assert.equal(isValidCustomPricing({ pricingCurrency: "USD", inputPerMillion: "1", cachedInputPerMillion: "", outputPerMillion: "2" } as VendorModelDraft), true);
assert.equal(isValidCustomPricing({ pricingCurrency: "USD", inputPerMillion: "1", cachedInputPerMillion: "0.5", outputPerMillion: "2" } as VendorModelDraft), true);
assert.equal(isValidCustomPricing({ pricingCurrency: "", inputPerMillion: "1", cachedInputPerMillion: "", outputPerMillion: "2" } as VendorModelDraft), false);
assert.equal(isValidCustomPricing({ pricingCurrency: "USD", inputPerMillion: "-1", cachedInputPerMillion: "", outputPerMillion: "2" } as VendorModelDraft), false);

assert.equal(getVendorModelsErrorField({ code: "UNAUTHORIZED" }, { ...validVendor, authentication: "api-key" } as VendorDraft).field, "apiKey");
assert.equal(getVendorModelsErrorField({ code: "UNAUTHORIZED" }, validVendor).field, "authentication");
assert.equal(getVendorModelsErrorField({ message: "connect ECONNREFUSED" }, validVendor).field, "baseUrl");
assert.equal(getVendorModelsErrorField({ message: "weird failure" }, validVendor).field, "models");

const rows = parseLogRows([
  JSON.stringify({ time: "t1", level: "error", event: "request_failed", errorMessage: "boom", vendor: "v", statusCode: 500 }),
  "not-json-line",
  "",
]);
assert.equal(rows.length, 2);
assert.equal(rows[0].level, "text");
assert.equal(rows[0].tone, "neutral");

const infoA: ModelInfo = {
  displayName: "Model A",
  contextWindow: 128000,
  maxOutputTokens: 8192,
  capabilities: { toolCalling: true, vision: false, thinking: true },
  supportsReasoningEffort: ["low", "high"],
};
const infoB: ModelInfo = {
  displayName: "Model B",
  contextWindow: 200000,
  maxOutputTokens: 16384,
  capabilities: { toolCalling: true, vision: true, thinking: false },
};
const baseRowA: VendorModelDraft = {
  id: "model-a",
  enabled: true,
  pricingMode: "custom",
  pricingCurrency: "USD",
  inputPerMillion: "3",
  cachedInputPerMillion: "0.3",
  outputPerMillion: "15",
  vscode: { name: "My A", contextWindow: "128000", toolCalling: true },
};

// Switch A -> B: A's vscode + custom pricing (mode + currency) are snapshotted, B is filled fresh.
const toB = applyModelSwitch(baseRowA, "model-b", infoB);
assert.equal(toB.vscodeModelCache?.["model-a"]?.vscode?.name, "My A");
assert.equal(toB.vscodeModelCache?.["model-a"]?.pricingMode, "custom");
assert.deepEqual(toB.vscodeModelCache?.["model-a"]?.customPricing, { currency: "USD", inputPerMillion: "3", cachedInputPerMillion: "0.3", outputPerMillion: "15" });
assert.equal(toB.vscode?.name, "Model B");
assert.equal(toB.vscode?.contextWindow, "200000");
assert.equal(toB.vscode?.maxOutputTokens, "16384");
assert.equal(toB.vscode?.vision, true);
assert.equal(toB.vscode?.thinking, false);
assert.deepEqual(toB.vscode?.supportsReasoningEffort, undefined);
assert.equal(toB.inputPerMillion, "");
assert.equal(toB.cachedInputPerMillion, "");
assert.equal(toB.outputPerMillion, "");

// Switch B -> A (unsaved): the snapshot is restored, cache no longer holds A.
const rowB: VendorModelDraft = {
  id: "model-b",
  enabled: true,
  pricingMode: "custom",
  pricingCurrency: "USD",
  vscode: toB.vscode,
  vscodeModelCache: toB.vscodeModelCache,
};
const backToA = applyModelSwitch(rowB, "model-a", infoA);
assert.equal(backToA.vscode?.name, "My A");
assert.equal(backToA.vscode?.contextWindow, "128000");
assert.equal(backToA.vscode?.toolCalling, true);
assert.equal(backToA.inputPerMillion, "3");
assert.equal(backToA.cachedInputPerMillion, "0.3");
assert.equal(backToA.outputPerMillion, "15");
// A was consumed from the cache; B's own snapshot stays for a later switch back.
assert.equal(backToA.vscodeModelCache?.["model-a"], undefined);
assert.equal(backToA.vscodeModelCache?.["model-b"]?.vscode?.name, "Model B");

// No snapshot for the incoming model: fresh fill from info, pricing cleared.
const fresh = applyModelSwitch({ id: "model-a", enabled: true, pricingMode: "openai" } as VendorModelDraft, "model-b", infoB);
assert.equal(fresh.vscode?.name, "Model B");
assert.equal(fresh.inputPerMillion, "");
assert.equal(fresh.vscodeModelCache, undefined);

// Unknown model (info null): vscode cleared, no cache entry created.
const unknown = applyModelSwitch(baseRowA, "model-x", null);
assert.equal(unknown.vscode, undefined);
assert.equal(unknown.vscodeModelCache?.["model-a"]?.vscode?.name, "My A");

// Same id: no snapshot, no cache mutation.
const same = applyModelSwitch(baseRowA, "model-a", infoA);
assert.equal(same.vscodeModelCache, undefined);
assert.equal(same.inputPerMillion, "");

// Non-custom pricing: only the vscode section is snapshotted.
const nonCustom = applyModelSwitch(
  { id: "model-a", enabled: true, pricingMode: "openai", inputPerMillion: "3", vscode: { name: "My A" } } as VendorModelDraft,
  "model-b",
  infoB,
);
assert.deepEqual(nonCustom.vscodeModelCache?.["model-a"], { vscode: { name: "My A" } });
assert.equal(rows[1].level, "error");
assert.equal(rows[1].tone, "danger");
assert.equal(rows[1].message, "boom");
assert.equal(rows[1].statusCode, 500);
assert.equal(parseLogRows(null).length, 0);
assert.equal(parseLogRows("single").length, 0);

assert.equal(formatLogTime(""), "");
assert.equal(formatLogTime("not-a-date"), "not-a-date");
assert.notEqual(formatLogTime("2026-01-01T00:00:00Z"), "");

assert.equal(
  formatUserErrorMessage("Error invoking remote method 'update:download': TypeError: fetch failed"),
  "Network request failed. Check your network connection and try again.",
);
assert.equal(
  formatUserErrorMessage(new Error("Error invoking remote method 'vendor:listModels': Error: connect ECONNREFUSED 127.0.0.1:8000")),
  "Connection refused. The server or service is not reachable.",
);
assert.equal(
  formatUserErrorMessage("Error invoking remote method 'update:check': Error: getaddrinfo ENOTFOUND api.github.com"),
  "Server address could not be resolved. Check your network connection.",
);
assert.equal(
  formatUserErrorMessage("Error: Request timed out"),
  "Request timed out. Please check your network and try again.",
);
assert.equal(
  formatUserErrorMessage("EPERM: operation not permitted"),
  "Permission denied. Check file or folder permissions.",
);
assert.equal(
  formatUserErrorMessage("ENOENT: no such file or directory"),
  "File or directory not found.",
);
assert.equal(
  formatUserErrorMessage("Invalid port number"),
  "Invalid port number",
);
assert.equal(
  formatUserErrorMessage(null),
  "An unexpected error occurred.",
);

console.log("app-model tests passed");
