import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRemotePricing,
  getCatalogPriceView,
  getPricingCatalogSummary,
  type RemotePricingData,
} from "../src/usage.ts";
import {
  PRICING_CACHE_FILENAME,
  PRICING_REMOTE_URL,
  fetchRemotePricing,
  loadPricingCache,
  parseRemotePricing,
  refreshPricing,
  resolvePricingRemoteUrl,
  savePricingCache,
  startPricingRefresh,
} from "../src/pricing-updater.ts";

const tempDir = mkdtempSync(join(tmpdir(), "heimdall-pricing-test-"));

function remoteData(updatedAt: string): RemotePricingData {
  return {
    schemaVersion: 1,
    updatedAt,
    catalogs: {
      openai: {
        updatedAt,
        models: {
          "gpt-5.6-sol": { currency: "USD", inputPerMillion: 4.5, cachedInputPerMillion: 0.4, outputPerMillion: 22 },
          "gpt-test-new-model": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 2 },
        },
      },
      deepseek: {
        models: {
          "deepseek-v4-flash": {
            peak: { currency: "CNY", inputPerMillion: 10, cachedInputPerMillion: 1, outputPerMillion: 30 },
            offPeak: { currency: "CNY", inputPerMillion: 2, cachedInputPerMillion: 0.2, outputPerMillion: 6 },
          },
        },
      },
      unknownVendor: {
        models: {
          "whatever": { currency: "USD", inputPerMillion: 1, cachedInputPerMillion: null, outputPerMillion: 1 },
        },
      },
    },
  };
}

async function createMockPricingServer(payload: unknown, { status = 200, hang = false } = {}) {
  const server = http.createServer((req, res) => {
    if (hang) {
      return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as import("net").AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/pricing.json` };
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

try {
  // --- applyRemotePricing merge semantics ---
  const beforeSol = getCatalogPriceView("openai", "gpt-5.6-sol")!.pricing;
  const applied = applyRemotePricing(remoteData("2026-11-01"));
  assert.ok(applied.applied >= 3, `expected at least 3 applied models, got ${applied.applied}`);
  assert.ok(applied.catalogs.includes("openai"));
  assert.ok(applied.catalogs.includes("deepseek"));
  assert.ok(!applied.catalogs.includes("unknownVendor"));

  const solView = getCatalogPriceView("openai", "gpt-5.6-sol")!;
  assert.equal(solView.pricing.inputPerMillion, 4.5);
  assert.equal(solView.pricing.outputPerMillion, 22);
  assert.notEqual(solView.pricing.inputPerMillion, beforeSol.inputPerMillion);
  assert.equal(solView.updatedAt, "2026-11-01");

  const newModelView = getCatalogPriceView("openai", "gpt-test-new-model");
  assert.ok(newModelView, "remote model should be added to the catalog");
  assert.equal(newModelView!.pricing.outputPerMillion, 2);

  const deepseekView = getCatalogPriceView("deepseek", "deepseek-v4-flash")!;
  assert.equal(deepseekView.pricing.inputPerMillion, 10);
  assert.equal(deepseekView.offPeakPricing?.inputPerMillion, 2);

  const openaiSummary = getPricingCatalogSummary().find((entry) => entry.key === "openai")!;
  assert.equal(openaiSummary.updatedAt, "2026-11-01");

  // Unknown catalog keys are ignored, built-in entries are never removed.
  assert.equal(getCatalogPriceView("unknownVendor", "whatever"), null);
  assert.ok(getCatalogPriceView("anthropic", "claude-opus-5-5"), "built-in entries must survive remote merge");

  // --- parseRemotePricing validation ---
  assert.equal(parseRemotePricing(remoteData("2026-11-01")).updatedAt, "2026-11-01");
  assert.throws(
    () => parseRemotePricing({ ...remoteData("2026-11-01"), schemaVersion: 2 }),
    /Invalid remote pricing data/,
  );
  assert.throws(
    () => parseRemotePricing({
      ...remoteData("2026-11-01"),
      catalogs: { openai: { models: { "bad": { currency: "USD", inputPerMillion: -1, cachedInputPerMillion: null, outputPerMillion: 1 } } } },
    }),
    /Invalid remote pricing data/,
  );
  assert.throws(
    () => parseRemotePricing({ schemaVersion: 1, updatedAt: "2026-11-01", catalogs: { openai: { models: { bad: "not-a-pricing" } } } }),
    /Invalid remote pricing data/,
  );
  assert.throws(
    () => parseRemotePricing({ schemaVersion: 1, updatedAt: "2026-11-01", catalogs: { openai: "not-an-entry" } }),
    /Invalid remote pricing data/,
  );

  // --- cache roundtrip ---
  const cacheDir = join(tempDir, "cache");
  assert.equal(loadPricingCache(cacheDir), null);
  savePricingCache(cacheDir, remoteData("2026-11-01"));
  assert.deepEqual(loadPricingCache(cacheDir), remoteData("2026-11-01"));
  writeFileSync(join(cacheDir, PRICING_CACHE_FILENAME), "{not json", "utf8");
  assert.equal(loadPricingCache(cacheDir), null);
  savePricingCache(cacheDir, remoteData("2026-11-01"));

  // --- refreshPricing against a mock server ---
  const { server: newerServer, url: newerUrl } = await createMockPricingServer(remoteData("2026-12-01"));
  try {
    const refreshed = await refreshPricing({ dataDir: cacheDir, url: newerUrl });
    if (refreshed.status !== "updated") {
      throw new Error(`expected updated status, got ${refreshed.status}`);
    }
    assert.equal(refreshed.updatedAt, "2026-12-01");
    assert.ok(refreshed.models >= 3);
    assert.equal(loadPricingCache(cacheDir)!.updatedAt, "2026-12-01");

    const unchanged = await refreshPricing({ dataDir: cacheDir, url: newerUrl });
    assert.equal(unchanged.status, "unchanged");
  } finally {
    newerServer.close();
  }

  const { server: staleServer, url: staleUrl } = await createMockPricingServer(remoteData("2026-10-01"));
  try {
    const stale = await refreshPricing({ dataDir: cacheDir, url: staleUrl });
    assert.equal(stale.status, "unchanged");
    assert.equal(loadPricingCache(cacheDir)!.updatedAt, "2026-12-01");
  } finally {
    staleServer.close();
  }

  const { server: errorServer, url: errorUrl } = await createMockPricingServer({ broken: true }, { status: 500 });
  try {
    const failed = await refreshPricing({ dataDir: cacheDir, url: errorUrl });
    if (failed.status !== "failed") {
      throw new Error(`expected failed status, got ${failed.status}`);
    }
    assert.match(failed.error, /status 500/);
    assert.equal(loadPricingCache(cacheDir)!.updatedAt, "2026-12-01");
  } finally {
    errorServer.close();
  }

  const downServer = http.createServer(() => {});
  downServer.listen(0, "127.0.0.1");
  await once(downServer, "listening");
  const downUrl = `http://127.0.0.1:${(downServer.address() as import("net").AddressInfo).port}/pricing.json`;
  downServer.close();
  const refused = await refreshPricing({ dataDir: cacheDir, url: downUrl });
  assert.equal(refused.status, "failed");
  assert.equal(loadPricingCache(cacheDir)!.updatedAt, "2026-12-01");

  // --- fetchRemotePricing timeout ---
  const { server: hangServer, url: hangUrl } = await createMockPricingServer(null, { hang: true });
  try {
    await assert.rejects(() => fetchRemotePricing(hangUrl, 100), /aborted|abort|timeout/i);
  } finally {
    hangServer.close();
  }

  // --- resolvePricingRemoteUrl env override ---
  assert.equal(resolvePricingRemoteUrl(), PRICING_REMOTE_URL);
  process.env.HEIMDALL_PRICING_URL = "http://127.0.0.1:9/custom.json";
  assert.equal(resolvePricingRemoteUrl(), "http://127.0.0.1:9/custom.json");
  delete process.env.HEIMDALL_PRICING_URL;

  // --- startPricingRefresh applies cache and refreshes immediately ---
  const refreshDir = join(tempDir, "refresh");
  const { server: refreshServer, url: refreshUrl } = await createMockPricingServer(remoteData("2026-12-02"));
  try {
    const stop = startPricingRefresh({ dataDir: refreshDir, url: refreshUrl, intervalMs: 60_000 });
    await waitFor(() => existsSync(join(refreshDir, PRICING_CACHE_FILENAME)), "expected pricing cache to be written");
    assert.equal(loadPricingCache(refreshDir)!.updatedAt, "2026-12-02");
    stop();
  } finally {
    refreshServer.close();
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("pricing-updater tests passed");
