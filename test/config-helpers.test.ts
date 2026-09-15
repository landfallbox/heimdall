import assert from "node:assert/strict";
import { deepMerge, isPlainObject, normalizeVendor, normalizeVendorModels, requiresRouterApiKey } from "../src/config.ts";

assert.equal(isPlainObject({}), true);
assert.equal(isPlainObject({ a: 1 }), true);
assert.equal(isPlainObject([]), false);
assert.equal(isPlainObject(null), false);
assert.equal(isPlainObject("str"), false);
assert.equal(isPlainObject(new Date()), false);

assert.deepEqual(deepMerge({ a: 1, b: { x: 1, y: 2 } }, { b: { y: 3 }, c: 4 }), { a: 1, b: { x: 1, y: 3 }, c: 4 });
assert.deepEqual(deepMerge({ a: [1, 2] }, { a: [3] }), { a: [3] });
assert.equal(deepMerge({ a: 1 }, { a: undefined }).a, 1);
assert.deepEqual(deepMerge({}, { a: 1 }), { a: 1 });

assert.equal(requiresRouterApiKey("127.0.0.1"), false);
assert.equal(requiresRouterApiKey("localhost"), false);
assert.equal(requiresRouterApiKey("::1"), false);
assert.equal(requiresRouterApiKey("LOCALHOST"), false);
assert.equal(requiresRouterApiKey("0.0.0.0"), true);
assert.equal(requiresRouterApiKey("::"), true);
assert.equal(requiresRouterApiKey("192.168.1.5"), true);
assert.equal(requiresRouterApiKey("example.com"), true);

const vendor = normalizeVendor({ name: "V", baseUrl: "http://x/v1", apiKey: "k", model: "legacy-model" });
assert.equal(vendor.name, "V");
assert.equal(vendor.authentication, "api-key");
assert.equal(vendor.models[0].id, "legacy-model");
assert.equal(vendor.apiKey, "k");
assert.equal("model" in vendor, false);
assert.equal("timeoutMs" in vendor, false);

const noAuth = normalizeVendor({ name: "V", baseUrl: "http://x/v1" });
assert.equal(noAuth.authentication, "none");
assert.equal("apiKey" in noAuth, false);

assert.deepEqual(normalizeVendorModels(["a", "b"]), [
  { id: "a", enabled: true },
  { id: "b", enabled: true },
]);
assert.deepEqual(normalizeVendorModels(undefined), []);
assert.deepEqual(normalizeVendorModels("legacy", { legacyModelId: "legacy" }), [{ id: "legacy", enabled: true }]);
assert.deepEqual(
  normalizeVendorModels([{ id: "m", pricing: { mode: "deepseek" } }, { id: "m2", enabled: false }]),
  [
    { id: "m", enabled: true, pricing: { mode: "deepseek" } },
    { id: "m2", enabled: false },
  ],
);

console.log("config-helpers tests passed");
