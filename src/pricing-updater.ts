import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { applyRemotePricing, type RemotePricingData } from "./usage.ts";
import type { Logger } from "./logger.ts";

export const PRICING_CACHE_FILENAME = "pricing-cache.json";
export const PRICING_REMOTE_URL = "https://raw.githubusercontent.com/landfallbox/heimdall/main/data/pricing.json";
export const PRICING_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRICING_FETCH_TIMEOUT_MS = 8000;

const pricingSchema = z.object({
  currency: z.string().min(1),
  inputPerMillion: z.number().nonnegative(),
  cachedInputPerMillion: z.number().nonnegative().nullable(),
  outputPerMillion: z.number().nonnegative(),
});
const rateCardSchema = z.object({
  peak: pricingSchema,
  offPeak: pricingSchema,
});
const pricingTierSchema = z.object({
  condition: z.string().min(1),
  note: z.string().min(1).optional(),
  inputPerMillion: z.number().nonnegative(),
  cachedInputPerMillion: z.number().nonnegative().nullable().optional(),
  outputPerMillion: z.number().nonnegative(),
  isBase: z.boolean().optional(),
});
const tieredPricingSchema = z.object({
  pricing: pricingSchema,
  tiers: z.array(pricingTierSchema).min(1),
});
const remoteCatalogEntrySchema = z.object({
  sourceUrl: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
  models: z.record(z.string(), rateCardSchema.or(tieredPricingSchema).or(pricingSchema)),
});
export const remotePricingSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().min(1),
  catalogs: z.record(z.string(), remoteCatalogEntrySchema),
});

export function resolvePricingRemoteUrl(): string {
  const override = String(process.env.HEIMDALL_PRICING_URL || "").trim();
  return override || PRICING_REMOTE_URL;
}

export function parseRemotePricing(value: unknown): RemotePricingData {
  const result = remotePricingSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.length ? issue.path.join(".") : "value"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid remote pricing data: ${details}`);
  }
  return result.data as RemotePricingData;
}

// Validates `value` against the remote pricing schema but returns the
// original object unchanged. Unlike parseRemotePricing, this does NOT
// re-serialize through zod, so extra top-level fields (e.g. the flat
// currency/inputPerMillion/... fields kept on tiered entries for legacy
// clients) are preserved. The refresh pipeline uses this before writing
// data/pricing.json so untouched vendors and their flat fields survive.
export function validateRemotePricing(value: unknown): RemotePricingData {
  const result = remotePricingSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.length ? issue.path.join(".") : "value"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid remote pricing data: ${details}`);
  }
  return value as RemotePricingData;
}

export function loadPricingCache(dataDir: string): RemotePricingData | null {
  const path = join(dataDir, PRICING_CACHE_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseRemotePricing(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function savePricingCache(dataDir: string, data: RemotePricingData): void {
  const path = join(dataDir, PRICING_CACHE_FILENAME);
  mkdirSync(dataDir, { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmpPath, path);
}

export async function fetchRemotePricing(url: string, timeoutMs = PRICING_FETCH_TIMEOUT_MS): Promise<RemotePricingData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Pricing fetch failed with status ${response.status}`);
    }
    return parseRemotePricing(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export type RefreshPricingResult =
  | { status: "updated"; updatedAt: string; models: number; catalogs: string[] }
  | { status: "unchanged"; updatedAt: string }
  | { status: "failed"; error: string };

type PricingLogger = Pick<Logger, "info" | "warn">;

/**
 * Fetches the remote pricing file and applies it when newer than the local
 * cache. The cache file is the sync point between the Router process and the
 * GUI; failures keep the previous cache and built-in catalogs intact.
 */
export async function refreshPricing({ dataDir, logger, url = resolvePricingRemoteUrl() }: {
  dataDir: string;
  logger?: PricingLogger;
  url?: string;
}): Promise<RefreshPricingResult> {
  let data: RemotePricingData;
  try {
    data = await fetchRemotePricing(url);
  } catch (error) {
    const message = (error as Error).message || String(error);
    logger?.warn("pricing_remote_failed", { error: message });
    return { status: "failed", error: message };
  }

  const cache = loadPricingCache(dataDir);
  if (cache && cache.updatedAt >= data.updatedAt) {
    return { status: "unchanged", updatedAt: cache.updatedAt };
  }

  const applied = applyRemotePricing(data);
  savePricingCache(dataDir, data);
  logger?.info("pricing_remote_updated", {
    updatedAt: data.updatedAt,
    models: applied.applied,
    catalogs: applied.catalogs.join(","),
  });
  return { status: "updated", updatedAt: data.updatedAt, models: applied.applied, catalogs: applied.catalogs };
}

export function applyPricingCache(dataDir: string, logger?: PricingLogger): void {
  const cache = loadPricingCache(dataDir);
  if (!cache) {
    return;
  }
  const applied = applyRemotePricing(cache);
  logger?.info("pricing_cache_applied", {
    updatedAt: cache.updatedAt,
    models: applied.applied,
    catalogs: applied.catalogs.join(","),
  });
}

/** Applies the cache immediately, then refreshes remotely on an interval. Returns a stop function. */
export function startPricingRefresh({ dataDir, logger, intervalMs = PRICING_REFRESH_INTERVAL_MS, url }: {
  dataDir: string;
  logger?: PricingLogger;
  intervalMs?: number;
  url?: string;
}): () => void {
  applyPricingCache(dataDir, logger);
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    try {
      await refreshPricing({ dataDir, logger, url });
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
