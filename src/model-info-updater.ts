import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyModelInfo, type RemoteModelInfoData } from "./model-info.ts";
import type { Logger } from "./logger.ts";

// The validation schema lives in model-info-schema.ts (which does not import
// the generated model-info-data.ts) so data/model-info.json can be validated
// even when the generated file is missing. Re-exported for compatibility.
export { remoteModelInfoSchema, parseRemoteModelInfo } from "./model-info-schema.ts";
import { parseRemoteModelInfo } from "./model-info-schema.ts";

export const MODEL_INFO_CACHE_FILENAME = "model-info-cache.json";
export const MODEL_INFO_REMOTE_URL = "https://raw.githubusercontent.com/landfallbox/heimdall/main/data/model-info.json";
export const MODEL_INFO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MODEL_INFO_FETCH_TIMEOUT_MS = 8000;

export function resolveModelInfoRemoteUrl(): string {
  const override = String(process.env.HEIMDALL_MODEL_INFO_URL || "").trim();
  return override || MODEL_INFO_REMOTE_URL;
}

export function loadModelInfoCache(dataDir: string): RemoteModelInfoData | null {
  const path = join(dataDir, MODEL_INFO_CACHE_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseRemoteModelInfo(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function saveModelInfoCache(dataDir: string, data: RemoteModelInfoData): void {
  const path = join(dataDir, MODEL_INFO_CACHE_FILENAME);
  mkdirSync(dataDir, { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
}

export async function fetchRemoteModelInfo(url: string, timeoutMs = MODEL_INFO_FETCH_TIMEOUT_MS): Promise<RemoteModelInfoData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Model info fetch failed with status ${response.status}`);
    }
    return parseRemoteModelInfo(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export type RefreshModelInfoResult =
  | { status: "updated"; updatedAt: string; models: number }
  | { status: "unchanged"; updatedAt: string }
  | { status: "failed"; error: string };

type ModelInfoLogger = Pick<Logger, "info" | "warn">;

/**
 * Fetches the remote model info file and applies it when newer than the local
 * cache. The cache file is the sync point between the Router process and the
 * GUI; failures keep the previous cache and built-in metadata intact.
 */
export async function refreshModelInfo({ dataDir, logger, url = resolveModelInfoRemoteUrl() }: {
  dataDir: string;
  logger?: ModelInfoLogger;
  url?: string;
}): Promise<RefreshModelInfoResult> {
  let data: RemoteModelInfoData;
  try {
    data = await fetchRemoteModelInfo(url);
  } catch (error) {
    const message = (error as Error).message || String(error);
    logger?.warn("model_info_remote_failed", { error: message });
    return { status: "failed", error: message };
  }

  const cache = loadModelInfoCache(dataDir);
  if (cache && cache.updatedAt > data.updatedAt) {
    return { status: "unchanged", updatedAt: cache.updatedAt };
  }
  if (
    cache &&
    cache.updatedAt === data.updatedAt &&
    JSON.stringify(cache.models) === JSON.stringify(data.models)
  ) {
    return { status: "unchanged", updatedAt: cache.updatedAt };
  }

  const applied = applyModelInfo(data);
  saveModelInfoCache(dataDir, data);
  logger?.info("model_info_remote_updated", {
    updatedAt: data.updatedAt,
    models: applied.applied,
  });
  return { status: "updated", updatedAt: data.updatedAt, models: applied.applied };
}

export function applyModelInfoCache(dataDir: string, logger?: ModelInfoLogger): void {
  const cache = loadModelInfoCache(dataDir);
  if (!cache) {
    return;
  }
  const applied = applyModelInfo(cache);
  logger?.info("model_info_cache_applied", {
    updatedAt: cache.updatedAt,
    models: applied.applied,
  });
}

/** Applies the cache immediately, then refreshes remotely on an interval. Returns a stop function. */
export function startModelInfoRefresh({ dataDir, logger, intervalMs = MODEL_INFO_REFRESH_INTERVAL_MS, url }: {
  dataDir: string;
  logger?: ModelInfoLogger;
  intervalMs?: number;
  url?: string;
}): () => void {
  applyModelInfoCache(dataDir);
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    try {
      await refreshModelInfo({ dataDir, logger, url });
    } catch (error) {
      logger?.warn("model_info_refresh_tick_failed", { error: (error as Error).message || String(error) });
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
