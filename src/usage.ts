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

export const OPENAI_PRICING_UPDATED_AT = "2026-09-05";
export const OPENAI_PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";
export const DEEPSEEK_PRICING_UPDATED_AT = "2026-08-16";
export const DEEPSEEK_PRICING_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing";
export const DEEPSEEK_PEAK_HOURS: [number, number][] = [[1, 4], [6, 10]];
export const ANTHROPIC_PRICING_UPDATED_AT = "2026-09-03";
export const ANTHROPIC_PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export const GOOGLE_PRICING_UPDATED_AT = "2026-10-01";
export const GOOGLE_PRICING_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing";
export const KIMI_PRICING_UPDATED_AT = "2026-09-20";
export const KIMI_PRICING_SOURCE = "https://platform.kimi.ai/docs/pricing/chat.md";
export const GLM_PRICING_UPDATED_AT = "2026-09-28";
export const GLM_PRICING_SOURCE = "https://docs.bigmodel.cn/cn/guide/start/pricing.md";
export const MIMO_PRICING_UPDATED_AT = "2026-10-06";
export const MIMO_PRICING_SOURCE = "https://mimo.mi.com/docs/zh-CN/pricing";

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

const OPENAI_STANDARD_PRICING: Record<string, Pricing> = Object.freeze({
  "gpt-6-astra": price(10, 1, 50),
  "gpt-5.6-sol": price(5, 0.5, 30),
  "gpt-5.6-terra": price(2, 0.2, 12),
  "gpt-5.6-luna": price(0.2, 0.02, 1.2),
  "gpt-5.5": price(5, 0.5, 30),
  "gpt-5.5-pro": price(30, null, 180),
  "gpt-5.4": price(2.5, 0.25, 15),
  "gpt-5.4-mini": price(0.75, 0.075, 4.5),
  "gpt-5.4-nano": price(0.2, 0.02, 1.25),
  "gpt-5.4-pro": price(30, null, 180),
  "gpt-5.3-codex": price(1.75, 0.175, 14),
  "gpt-5.2": price(1.75, 0.175, 14),
  "gpt-5.2-pro": price(21, null, 168),
  "gpt-5.1": price(1.25, 0.125, 10),
  "gpt-5": price(1.25, 0.125, 10),
  "gpt-5-mini": price(0.25, 0.025, 2),
  "gpt-5-nano": price(0.05, 0.005, 0.4),
  "gpt-5-pro": price(15, null, 120),
  "gpt-5-search-api": price(1.25, 0.125, 10),
  "gpt-4.1": price(2, 0.5, 8),
  "gpt-4.1-mini": price(0.4, 0.1, 1.6),
  "gpt-4.1-nano": price(0.1, 0.025, 0.4),
  "gpt-4o": price(2.5, 1.25, 10),
  "gpt-4o-2024-05-13": price(5, null, 15),
  "gpt-4o-mini": price(0.15, 0.075, 0.6),
  "o1": price(15, 7.5, 60),
  "o1-pro": price(150, null, 600),
  "o3": price(2, 0.5, 8),
  "o3-pro": price(20, null, 80),
  "o3-mini": price(1.1, 0.55, 4.4),
  "o4-mini": price(1.1, 0.275, 4.4),
  "gpt-4-turbo-2024-04-09": price(10, null, 30),
  "gpt-4-0613": price(30, null, 60),
  "gpt-3.5-turbo": price(0.5, null, 1.5),
  "gpt-3.5-turbo-0125": price(0.5, null, 1.5),
  "gpt-3.5-turbo-1106": price(1, null, 2),
  "gpt-3.5-turbo-instruct": price(1.5, null, 2),
  "davinci-002": price(2, null, 2),
  "babbage-002": price(0.4, null, 0.4),
  "chat-latest": price(5, 0.5, 30),
});

const DEEPSEEK_STANDARD_PRICING: Record<string, RateCard> = Object.freeze({
  "deepseek-v4-flash": rateCards(price(0.44, 0.014, 1.32, "CNY"), price(0.22, 0.007, 0.66, "CNY")),
  "deepseek-v4.1-flash": rateCards(price(2, 0.04, 8, "CNY"), price(1, 0.02, 4, "CNY")),
  "deepseek-v4-pro": rateCards(price(1.32, 0.044, 3.96, "CNY"), price(0.66, 0.022, 1.98, "CNY")),
});

const ANTHROPIC_STANDARD_PRICING: Record<string, Pricing> = Object.freeze({
  "claude-opus-4.6": price(5, 0.5, 25),
  "claude-opus-4.5": price(5, 0.5, 25),
  "claude-opus-4.1": price(15, 1.5, 75),
  "claude-sonnet-4.6": price(3, 0.3, 15),
  "claude-sonnet-4.5": price(3, 0.3, 15),
  "claude-sonnet-4": price(3, 0.3, 15),
  "claude-haiku-4.5": price(1, 0.1, 5),
  "claude-3-5-sonnet": price(3, 0.3, 15),
  "claude-3-5-haiku": price(0.8, 0.08, 4),
  "claude-3-opus": price(15, 1.5, 75),
  "claude-3-haiku": price(0.25, 0.025, 1.25),
});

const GOOGLE_STANDARD_PRICING: Record<string, Pricing> = Object.freeze({
  "gemini-3.1-pro": price(2, 0.2, 12),
  "gemini-3-pro": price(2, 0.2, 12),
  "gemini-3.5-flash": price(1.5, 0.15, 9),
  "gemini-3.8-flash": price(0.75, 0.075, 3.75),
  "gemini-3.7-flash": price(0.75, 0.075, 3.75),
  "gemini-3.6-flash": price(0.75, 0.075, 3.75),
  "gemini-3-flash": price(0.5, 0.05, 3),
  "gemini-3.5-flash-lite": price(0.3, 0.03, 2.5),
  "gemini-3.1-flash-lite": price(0.25, 0.025, 1.5),
  "gemini-2.5-pro": price(1.25, 0.125, 10),
  "gemini-2.5-flash": price(0.3, 0.03, 2.5),
  "gemini-2.5-flash-lite": price(0.1, 0.01, 0.4),
});

const KIMI_STANDARD_PRICING: Record<string, Pricing> = Object.freeze({
  "kimi-k3": price(3, 0.3, 15),
  "kimi-k2.7-code": price(0.95, 0.19, 4),
  "kimi-k2.7-code-highspeed": price(1.9, 0.38, 8),
  "kimi-k2.6": price(0.95, 0.16, 4),
  "kimi-k2.5": price(0.6, null, 3),
  "kimi-k2": price(0.6, null, 2.5),
});

// 智谱按 输入/缓存命中/输出 分别计费，单位为元/百万 tokens。带长度分档的模型取最常用档位（输入 <32K）。
const GLM_STANDARD_PRICING: Record<string, Pricing> = Object.freeze({
  "glm-5.3": price(8, 2, 28, "CNY"),
  "glm-5.3-flash": price(0.8, 0.23, 2.8, "CNY"),
  "glm-5.3-flashx": price(2, 0.57, 7, "CNY"),
  "glm-5.2": price(8, 2, 28, "CNY"),
  "glm-5.1": price(6, 1.3, 24, "CNY"),
  "glm-5-turbo": price(5, 1.2, 22, "CNY"),
  "glm-5": price(4, 1, 18, "CNY"),
  "glm-4.7": price(2, 0.4, 8, "CNY"),
  "glm-4.5-air": price(0.8, 0.16, 2, "CNY"),
  "glm-4.6v": price(1, 0.2, 3, "CNY"),
  "glm-4.7-flashx": price(0.5, 0.1, 3, "CNY"),
});

// 小米 MiMo 按国内人民币定价（元/百万 tokens）。官方另有海外美元价；mimo-v2.5-pro/mimo-v2.5 将于 2026-10-21 下线。
const MIMO_STANDARD_PRICING: Record<string, Pricing> = Object.freeze({
  "mimo-v2.6-pro": price(3, 0.025, 6, "CNY"),
  "mimo-v2.6-flash": price(1, 0.02, 2, "CNY"),
  "mimo-v2.6-pro-ultraspeed": price(30, 0.25, 60, "CNY"),
  "mimo-v2.5-pro": price(3, 0.025, 6, "CNY"),
  "mimo-v2.5": price(1, 0.02, 2, "CNY"),
});

export const PRICING_CATALOGS: Record<string, PricingCatalog> = Object.freeze({
  openai: {
    sourceUrl: OPENAI_PRICING_SOURCE,
    updatedAt: OPENAI_PRICING_UPDATED_AT,
    peakHours: null,
    models: OPENAI_STANDARD_PRICING,
  },
  deepseek: {
    sourceUrl: DEEPSEEK_PRICING_SOURCE,
    updatedAt: DEEPSEEK_PRICING_UPDATED_AT,
    peakHours: DEEPSEEK_PEAK_HOURS,
    models: DEEPSEEK_STANDARD_PRICING,
  },
  anthropic: {
    sourceUrl: ANTHROPIC_PRICING_SOURCE,
    updatedAt: ANTHROPIC_PRICING_UPDATED_AT,
    peakHours: null,
    models: ANTHROPIC_STANDARD_PRICING,
  },
  google: {
    sourceUrl: GOOGLE_PRICING_SOURCE,
    updatedAt: GOOGLE_PRICING_UPDATED_AT,
    peakHours: null,
    models: GOOGLE_STANDARD_PRICING,
  },
  kimi: {
    sourceUrl: KIMI_PRICING_SOURCE,
    updatedAt: KIMI_PRICING_UPDATED_AT,
    peakHours: null,
    models: KIMI_STANDARD_PRICING,
  },
  glm: {
    sourceUrl: GLM_PRICING_SOURCE,
    updatedAt: GLM_PRICING_UPDATED_AT,
    peakHours: null,
    models: GLM_STANDARD_PRICING,
  },
  mimo: {
    sourceUrl: MIMO_PRICING_SOURCE,
    updatedAt: MIMO_PRICING_UPDATED_AT,
    peakHours: null,
    models: MIMO_STANDARD_PRICING,
  },
});

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
  return Object.entries(OPENAI_STANDARD_PRICING).map(([model, pricing]) => ({ model, ...pricing }));
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

function price(inputPerMillion: number, cachedInputPerMillion: number | null, outputPerMillion: number, currency = "USD"): Pricing {
  return { currency, inputPerMillion, cachedInputPerMillion, outputPerMillion };
}

function rateCards(peak: Pricing, offPeak: Pricing): RateCard {
  return { peak, offPeak };
}

function tokenCount(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function nonnegativeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
