import { BUILTIN_PRICING_DATA } from "./pricing-data.ts";

export interface Pricing {
  currency: string;
  inputPerMillion: number;
  cachedInputPerMillion: number | null;
  outputPerMillion: number;
}

export interface RateCard {
  peak: Pricing;
  offPeak: Pricing;
}

export interface PricingCatalog {
  sourceUrl: string;
  updatedAt: string;
  peakHours: [number, number][] | null;
  models: Record<string, Pricing | RateCard>;
}

export interface RemotePricingCatalogEntry {
  sourceUrl?: string;
  updatedAt?: string;
  models: Record<string, Pricing | RateCard>;
}

export interface RemotePricingData {
  schemaVersion: number;
  updatedAt: string;
  catalogs: Record<string, RemotePricingCatalogEntry>;
}

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface Cost {
  amount: number;
  currency: string;
  pricing: unknown;
}

export interface ResolvedPricing extends Pricing {
  source: string;
  sourceModel: string;
  updatedAt: string | null;
  card?: string;
}

export const DEEPSEEK_PEAK_HOURS: [number, number][] = [[1, 4], [6, 10]];

export type PricingCatalogKey = "openai" | "deepseek" | "anthropic" | "google" | "kimi" | "glm" | "mimo";

export const PRICING_CATALOG_LABELS: Record<PricingCatalogKey, string> = Object.freeze({
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  google: "Google",
  kimi: "Kimi",
  glm: "GLM",
  mimo: "MiMo",
});

export const PRICING_CATALOG_KEYS = Object.keys(PRICING_CATALOG_LABELS) as PricingCatalogKey[];

// Bundled fallback pricing, generated from data/pricing.json by
// scripts/generate-pricing-data.mjs (run `npm run pricing:generate`). The top-level
// record is shallow-frozen so catalog keys are fixed, while each catalog object stays
// mutable so applyRemotePricing can override sourceUrl/updatedAt/models per model.
//
// Data notes (the prices themselves live in data/pricing.json):
// - Anthropic official model ids are hyphen-style (e.g. claude-opus-5-5); dot-style
//   aliases are kept for legacy config compatibility.
// - GLM bills input/cached-hit/output separately in CNY per million tokens; tiered
//   models use the most common tier (input <32K).
// - MiMo uses domestic CNY pricing (CNY per million tokens); an overseas USD price
//   also exists. mimo-v2.5-pro/mimo-v2.5 retire on 2026-10-21.
export const PRICING_CATALOGS: Record<string, PricingCatalog> = Object.freeze(
  Object.fromEntries(
    PRICING_CATALOG_KEYS.map((key): [string, PricingCatalog] => {
      const entry = BUILTIN_PRICING_DATA.catalogs[key];
      if (!entry || !entry.sourceUrl || !entry.updatedAt) {
        throw new Error("Bundled pricing data is incomplete for catalog " + key + "; run `npm run pricing:generate`.");
      }
      return [
        key,
        {
          sourceUrl: entry.sourceUrl,
          updatedAt: entry.updatedAt,
          peakHours: key === "deepseek" ? DEEPSEEK_PEAK_HOURS : null,
          models: Object.freeze(entry.models),
        },
      ];
    }),
  ),
);

export function normalizeUsage(body: any, format: unknown): Usage | null {
  const usage = body?.usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const responsesFormat = format === "responses";
  const inputTokens = tokenCount(responsesFormat ? usage.input_tokens : usage.prompt_tokens);
  const outputTokens = tokenCount(responsesFormat ? usage.output_tokens : usage.completion_tokens);
  const reportedTotal = tokenCount(usage.total_tokens);
  const totalTokens = reportedTotal ?? (
    inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  );
  if (totalTokens === null) {
    return null;
  }

  const inputDetails = responsesFormat ? usage.input_tokens_details : usage.prompt_tokens_details;
  const outputDetails = responsesFormat ? usage.output_tokens_details : usage.completion_tokens_details;
  const cachedInputTokens = Math.min(tokenCount(inputDetails?.cached_tokens) ?? 0, inputTokens ?? 0);

  return {
    inputTokens: inputTokens ?? Math.max(0, totalTokens - (outputTokens ?? 0)),
    cachedInputTokens,
    outputTokens: outputTokens ?? Math.max(0, totalTokens - (inputTokens ?? 0)),
    reasoningTokens: tokenCount(outputDetails?.reasoning_tokens) ?? 0,
    totalTokens,
  };
}

export function resolveModelPricing(model: string, pricingConfig: any, now = new Date()): ResolvedPricing | null {
  const custom = normalizeCustomPricing(pricingConfig);
  if (custom) {
    return {
      ...custom,
      source: "custom",
      sourceModel: String(model || "").trim(),
      updatedAt: null,
    };
  }

  const catalogKey = isPricingCatalogKey(pricingConfig?.mode) ? pricingConfig.mode : "openai";
  const catalog = PRICING_CATALOGS[catalogKey];
  const sourceModel = findCatalogPriceModel(catalog.models, model);
  if (!sourceModel) {
    return null;
  }

  const resolved = resolveCatalogPricing(catalog, sourceModel, now);
  return {
    ...resolved.pricing,
    source: catalogKey,
    sourceModel,
    updatedAt: catalog.updatedAt,
    ...(resolved.card ? { card: resolved.card } : {}),
  };
}

export function getCatalogPriceView(catalogKey: string, modelId: string) {
  const catalog = isPricingCatalogKey(catalogKey) ? PRICING_CATALOGS[catalogKey] : null;
  if (!catalog) {
    return null;
  }
  const sourceModel = findCatalogPriceModel(catalog.models, modelId);
  if (!sourceModel) {
    return null;
  }
  const entry = catalog.models[sourceModel];
  const hasRateCards = Boolean(catalog.peakHours && (entry as RateCard).peak && (entry as RateCard).offPeak);
  return {
    source: catalogKey,
    sourceModel,
    sourceUrl: catalog.sourceUrl,
    updatedAt: catalog.updatedAt,
    peakHours: hasRateCards ? catalog.peakHours : null,
    pricing: hasRateCards ? (entry as RateCard).peak : (entry as Pricing),
    offPeakPricing: hasRateCards ? (entry as RateCard).offPeak : null,
  };
}

export function estimateUsageCost(usage: Usage | null, pricing: ResolvedPricing | null): Cost | null {
  if (!usage || !pricing) {
    return null;
  }

  const inputTokens = tokenCount(usage.inputTokens);
  const cachedInputTokens = tokenCount(usage.cachedInputTokens) ?? 0;
  const outputTokens = tokenCount(usage.outputTokens);
  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  const boundedCachedTokens = Math.min(cachedInputTokens, inputTokens);
  const regularInputTokens = inputTokens - boundedCachedTokens;
  const cachedInputRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const amount = (
    regularInputTokens * pricing.inputPerMillion
    + boundedCachedTokens * cachedInputRate
    + outputTokens * pricing.outputPerMillion
  ) / 1_000_000;

  return {
    amount: Number(amount.toFixed(12)),
    currency: pricing.currency,
    pricing: { ...pricing },
  };
}

export function getOpenAIPricingCatalog() {
  return Object.entries(PRICING_CATALOGS.openai.models).map(([model, pricing]) => ({ model, ...pricing }));
}

export function isPricingCatalogKey(value: unknown): value is PricingCatalogKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRICING_CATALOGS, value);
}

export function getPricingCatalogSummary() {
  return PRICING_CATALOG_KEYS.map((key) => {
    const catalog = PRICING_CATALOGS[key];
    return {
      key,
      label: PRICING_CATALOG_LABELS[key],
      sourceUrl: catalog.sourceUrl,
      updatedAt: catalog.updatedAt,
      modelCount: Object.keys(catalog.models).length,
      peakHours: catalog.peakHours,
    };
  });
}

/**
 * Merges validated remote pricing into the in-memory catalogs. Remote entries
 * win per model; unknown catalog keys are ignored. Built-in entries are never
 * removed, so the built-in tables stay the offline fallback.
 */
export function applyRemotePricing(data: RemotePricingData): { applied: number; catalogs: string[] } {
  let applied = 0;
  const changed: string[] = [];
  for (const [key, entry] of Object.entries(data?.catalogs ?? {})) {
    const catalog = PRICING_CATALOGS[key];
    if (!catalog || !entry || typeof entry !== "object") {
      continue;
    }
    let catalogChanged = false;
    if (typeof entry.sourceUrl === "string" && entry.sourceUrl.trim()) {
      catalog.sourceUrl = entry.sourceUrl.trim();
      catalogChanged = true;
    }
    if (typeof entry.updatedAt === "string" && entry.updatedAt.trim()) {
      catalog.updatedAt = entry.updatedAt.trim();
      catalogChanged = true;
    }
    if (entry.models && typeof entry.models === "object") {
      const models = Object.entries(entry.models).filter(([, pricing]) => pricing && typeof pricing === "object");
      if (models.length > 0) {
        catalog.models = { ...catalog.models, ...Object.fromEntries(models) };
        applied += models.length;
        catalogChanged = true;
      }
    }
    if (catalogChanged) {
      changed.push(key);
    }
  }
  return { applied, catalogs: changed };
}

function findCatalogPriceModel(catalogModels: Record<string, Pricing | RateCard>, value: unknown): string | null {
  const model = String(value || "").trim().toLowerCase();
  if (catalogModels[model]) {
    return model;
  }

  const baseModel = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return catalogModels[baseModel] ? baseModel : null;
}

function resolveCatalogPricing(catalog: PricingCatalog, sourceModel: string, now: Date) {
  const entry = catalog.models[sourceModel];
  if (catalog.peakHours && (entry as RateCard).peak && (entry as RateCard).offPeak) {
    return isPeakHour(now, catalog.peakHours)
      ? { card: "peak", pricing: (entry as RateCard).peak }
      : { card: "off-peak", pricing: (entry as RateCard).offPeak };
  }
  return { card: null, pricing: entry as Pricing };
}

function isPeakHour(value: Date, peakHours: [number, number][]): boolean {
  const hour = new Date(value).getUTCHours();
  return peakHours.some(([start, end]) => hour >= start && hour < end);
}

function normalizeCustomPricing(value: any): Pricing | null {
  if (!value || value.mode !== "custom") {
    return null;
  }

  const inputPerMillion = nonnegativeNumber(value.inputPerMillion);
  const outputPerMillion = nonnegativeNumber(value.outputPerMillion);
  const cachedInputPerMillion = value.cachedInputPerMillion === null || value.cachedInputPerMillion === undefined
    ? null
    : nonnegativeNumber(value.cachedInputPerMillion);
  if (inputPerMillion === null || outputPerMillion === null || value.cachedInputPerMillion !== null
    && value.cachedInputPerMillion !== undefined && cachedInputPerMillion === null) {
    return null;
  }

  return {
    currency: String(value.currency || "USD").trim().toUpperCase() || "USD",
    inputPerMillion,
    cachedInputPerMillion,
    outputPerMillion,
  };
}

function tokenCount(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function nonnegativeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
