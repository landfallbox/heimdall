import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeConfig } from "../src/runtime-config.ts";

const tempDirectory = mkdtempSync(join(tmpdir(), "runtime-config-test-"));
const emptyConfigPath = join(tempDirectory, "config.json");
writeFileSync(emptyConfigPath, "{}", "utf8");

const vendorEnvKeys = [
  "VENDOR_A_BASE_URL",
  "VENDOR_A_API_KEY",
  "VENDOR_A_NAME",
  "VENDOR_A_MODEL",
  "VENDOR_A_REQUEST_FORMAT",
  "VENDOR_A_ENABLE_THINKING",
  "VENDOR_B_BASE_URL",
  "VENDOR_B_API_KEY",
  "VENDOR_B_MODEL",
];

function clearVendorEnv() {
  for (const key of vendorEnvKeys) {
    delete process.env[key];
  }
}

const savedRouterConfig = process.env.ROUTER_CONFIG;
const savedRouterApiKey = process.env.ROUTER_API_KEY;
process.env.ROUTER_CONFIG = emptyConfigPath;
process.env.ROUTER_API_KEY = "test-router-key";

try {
  clearVendorEnv();
  process.env.VENDOR_A_BASE_URL = "http://127.0.0.1:9000/v1";
  process.env.VENDOR_A_API_KEY = "secret-a";
  process.env.VENDOR_A_NAME = "Vendor A";
  process.env.VENDOR_A_MODEL = "model-a";
  process.env.VENDOR_A_REQUEST_FORMAT = "responses";
  process.env.VENDOR_A_ENABLE_THINKING = "1";
  const { config } = loadRuntimeConfig();
  assert.equal(config.vendors.length, 1);
  const vendor = config.vendors[0];
  assert.equal(vendor.name, "Vendor A");
  assert.equal(vendor.baseUrl, "http://127.0.0.1:9000/v1");
  assert.equal(vendor.requestFormat, "responses");
  assert.equal(vendor.authentication, "api-key");
  assert.equal(vendor.enableThinking, true);
  assert.equal(vendor.priority, 0);
  assert.equal(vendor.models.length, 1);
  assert.equal(vendor.models[0].id, "model-a");
  assert.equal(vendor.models[0].enabled, true);
  assert.equal(vendor.models[0].enableThinking, true);

  clearVendorEnv();
  process.env.VENDOR_A_BASE_URL = "http://127.0.0.1:9001/v1";
  process.env.VENDOR_A_MODEL = "model-a";
  const noKey = loadRuntimeConfig().config;
  assert.equal(noKey.vendors.length, 1);
  assert.equal(noKey.vendors[0].authentication, "none");
  assert.equal(noKey.vendors[0].name, "vendor-a");
  assert.equal(noKey.vendors[0].models[0].id, "model-a");

  clearVendorEnv();
  process.env.VENDOR_A_BASE_URL = "http://127.0.0.1:9002/v1";
  process.env.VENDOR_A_MODEL = "model-a";
  process.env.VENDOR_B_BASE_URL = "http://127.0.0.1:9003/v1";
  process.env.VENDOR_B_MODEL = "model-b";
  const two = loadRuntimeConfig().config;
  assert.equal(two.vendors.length, 2);
  assert.equal(two.vendors[0].priority, 0);
  assert.equal(two.vendors[1].priority, 1);
  assert.equal(two.vendors[1].name, "vendor-b");

  clearVendorEnv();
  process.env.VENDOR_A_BASE_URL = "http://127.0.0.1:9004/v1";
  assert.throws(() => loadRuntimeConfig(), /No vendors configured/);

  clearVendorEnv();
  assert.throws(() => loadRuntimeConfig(), /No vendors configured/);
} finally {
  clearVendorEnv();
  if (savedRouterConfig === undefined) {
    delete process.env.ROUTER_CONFIG;
  } else {
    process.env.ROUTER_CONFIG = savedRouterConfig;
  }
  if (savedRouterApiKey === undefined) {
    delete process.env.ROUTER_API_KEY;
  } else {
    process.env.ROUTER_API_KEY = savedRouterApiKey;
  }
  rmSync(tempDirectory, { recursive: true, force: true });
}

console.log("runtime-config tests passed");
