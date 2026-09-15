import assert from "node:assert/strict";
import {
  canLoadVendorModels,
  cloneVendor,
  endpointsFromDraft,
  formatLogTime,
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
assert.equal(rows[1].level, "error");
assert.equal(rows[1].tone, "danger");
assert.equal(rows[1].message, "boom");
assert.equal(rows[1].statusCode, 500);
assert.equal(parseLogRows(null).length, 0);
assert.equal(parseLogRows("single").length, 0);

assert.equal(formatLogTime(""), "");
assert.equal(formatLogTime("not-a-date"), "not-a-date");
assert.notEqual(formatLogTime("2026-01-01T00:00:00Z"), "");

console.log("app-model tests passed");
