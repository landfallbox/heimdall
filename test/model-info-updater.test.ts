import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModelInfo } from "../src/model-info.ts";
import type { RemoteModelInfoData } from "../src/model-info.ts";
import {
  MODEL_INFO_CACHE_FILENAME,
  MODEL_INFO_REMOTE_URL,
  fetchRemoteModelInfo,
  loadModelInfoCache,
  parseRemoteModelInfo,
  refreshModelInfo,
  resolveModelInfoRemoteUrl,
  saveModelInfoCache,
  startModelInfoRefresh,
} from "../src/model-info-updater.ts";

const tempDir = mkdtempSync(join(tmpdir(), "heimdall-model-info-test-"));

// Far-future dates keep the newer/stale ordering stable no matter what date a
// real refresh stamps into the bundled catalog.
const CACHE_DATE = "2999-11-01";
const NEWER_DATE = "2999-12-01";
const STALE_DATE = "2999-10-01";
const REFRESH_DATE = "2999-12-02";

function remoteData(updatedAt: string): RemoteModelInfoData {
  return {
    schemaVersion: 1,
    updatedAt,
    models: {
      "gpt-4o": { displayName: "GPT-4o (remote)" },
      "remote-only-model": { contextWindow: 256000, maxOutputTokens: 32000 },
    },
  };
}

async function createMockModelInfoServer(payload: unknown, { status = 200, hang = false } = {}) {
  const server = http.createServer((_req, res) => {
    if (hang) {
      return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as import("net").AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}/model-info.json` };
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
  // --- parseRemoteModelInfo validation ---
  assert.equal(parseRemoteModelInfo(remoteData(CACHE_DATE)).updatedAt, CACHE_DATE);
  assert.throws(() => parseRemoteModelInfo({ ...remoteData(CACHE_DATE), schemaVersion: 2 }), /Invalid remote model info data/);
  assert.throws(() => parseRemoteModelInfo({ schemaVersion: 1, updatedAt: "x", models: { bad: { contextWindow: 0 } } }), /Invalid remote model info data/);
  assert.throws(() => parseRemoteModelInfo({ schemaVersion: 1, updatedAt: "x", models: { bad: { surprise: true } } }), /Invalid remote model info data/);
  assert.throws(() => parseRemoteModelInfo({ schemaVersion: 1, updatedAt: "x", models: "not-an-object" }), /Invalid remote model info data/);

  // --- cache roundtrip ---
  const cacheDir = join(tempDir, "cache");
  assert.equal(loadModelInfoCache(cacheDir), null);
  saveModelInfoCache(cacheDir, remoteData(CACHE_DATE));
  assert.deepEqual(loadModelInfoCache(cacheDir), remoteData(CACHE_DATE));
  writeFileSync(join(cacheDir, MODEL_INFO_CACHE_FILENAME), "{not json", "utf8");
  assert.equal(loadModelInfoCache(cacheDir), null);
  saveModelInfoCache(cacheDir, remoteData(CACHE_DATE));

  // --- refreshModelInfo against a mock server ---
  const { server: newerServer, url: newerUrl } = await createMockModelInfoServer(remoteData(NEWER_DATE));
  try {
    const refreshed = await refreshModelInfo({ dataDir: cacheDir, url: newerUrl });
    if (refreshed.status !== "updated") {
      throw new Error(`expected updated status, got ${refreshed.status}`);
    }
    assert.equal(refreshed.updatedAt, NEWER_DATE);
    assert.equal(refreshed.models, 2);
    assert.equal(loadModelInfoCache(cacheDir)!.updatedAt, NEWER_DATE);
    assert.equal(getModelInfo("remote-only-model")?.contextWindow, 256000);

    const unchanged = await refreshModelInfo({ dataDir: cacheDir, url: newerUrl });
    assert.equal(unchanged.status, "unchanged");
  } finally {
    newerServer.close();
  }

  const { server: staleServer, url: staleUrl } = await createMockModelInfoServer(remoteData(STALE_DATE));
  try {
    const stale = await refreshModelInfo({ dataDir: cacheDir, url: staleUrl });
    assert.equal(stale.status, "unchanged");
    assert.equal(loadModelInfoCache(cacheDir)!.updatedAt, NEWER_DATE);
  } finally {
    staleServer.close();
  }

  const { server: errorServer, url: errorUrl } = await createMockModelInfoServer({ broken: true }, { status: 500 });
  try {
    const failed = await refreshModelInfo({ dataDir: cacheDir, url: errorUrl });
    if (failed.status !== "failed") {
      throw new Error(`expected failed status, got ${failed.status}`);
    }
    assert.match(failed.error, /status 500/);
    assert.equal(loadModelInfoCache(cacheDir)!.updatedAt, NEWER_DATE);
  } finally {
    errorServer.close();
  }

  const downServer = http.createServer(() => {});
  downServer.listen(0, "127.0.0.1");
  await once(downServer, "listening");
  const downUrl = `http://127.0.0.1:${(downServer.address() as import("net").AddressInfo).port}/model-info.json`;
  downServer.close();
  const refused = await refreshModelInfo({ dataDir: cacheDir, url: downUrl });
  assert.equal(refused.status, "failed");
  assert.equal(loadModelInfoCache(cacheDir)!.updatedAt, NEWER_DATE);

  // --- fetchRemoteModelInfo timeout ---
  const { server: hangServer, url: hangUrl } = await createMockModelInfoServer(null, { hang: true });
  try {
    await assert.rejects(() => fetchRemoteModelInfo(hangUrl, 100), /aborted|abort|timeout/i);
  } finally {
    hangServer.close();
  }

  // --- resolveModelInfoRemoteUrl env override ---
  const savedEnvUrl = process.env.HEIMDALL_MODEL_INFO_URL;
  delete process.env.HEIMDALL_MODEL_INFO_URL;
  try {
    assert.equal(resolveModelInfoRemoteUrl(), MODEL_INFO_REMOTE_URL);
    process.env.HEIMDALL_MODEL_INFO_URL = "http://127.0.0.1:9/custom.json";
    assert.equal(resolveModelInfoRemoteUrl(), "http://127.0.0.1:9/custom.json");
  } finally {
    if (savedEnvUrl === undefined) {
      delete process.env.HEIMDALL_MODEL_INFO_URL;
    } else {
      process.env.HEIMDALL_MODEL_INFO_URL = savedEnvUrl;
    }
  }

  // --- startModelInfoRefresh applies cache and refreshes immediately ---
  const refreshDir = join(tempDir, "refresh");
  const { server: refreshServer, url: refreshUrl } = await createMockModelInfoServer(remoteData(REFRESH_DATE));
  try {
    const stop = startModelInfoRefresh({ dataDir: refreshDir, url: refreshUrl, intervalMs: 60_000 });
    await waitFor(() => existsSync(join(refreshDir, MODEL_INFO_CACHE_FILENAME)), "expected model info cache to be written");
    assert.equal(loadModelInfoCache(refreshDir)!.updatedAt, REFRESH_DATE);
    stop();
  } finally {
    refreshServer.close();
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("model-info-updater tests passed");
