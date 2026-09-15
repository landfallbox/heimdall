export type CloseBehavior = "tray" | "exit" | "ask";
export type RequestFormat = "chat-completions" | "responses";
export type PricingMode = "openai" | "deepseek" | "custom";
export type Authentication = "none" | "api-key";

export interface VendorModelDraft {
  id: string;
  enabled: boolean;
  pricingMode?: PricingMode;
  pricingCurrency?: string;
  inputPerMillion?: string;
  cachedInputPerMillion?: string;
  outputPerMillion?: string;
  enableThinking?: boolean;
  pricing?: {
    mode: PricingMode;
    currency?: string;
    inputPerMillion?: number | string;
    cachedInputPerMillion?: number | string;
    outputPerMillion?: number | string;
  };
  [key: string]: unknown;
}

export interface VendorDraft {
  name?: string;
  baseUrl?: string;
  model?: string;
  models?: VendorModelDraft[];
  authentication?: Authentication;
  apiKey?: string;
  apiKeyHeader?: string;
  enabled?: boolean;
  requestFormat?: RequestFormat;
  chatCompletionsPath?: string;
  responsesPath?: string;
  [key: string]: unknown;
}

export interface RouterDraft {
  host: string;
  port: string;
  apiKey: string;
  requestTimeoutMs: string;
  maxBodyMb: string;
  maxBodyBytes: number;
  fallbackStatusCodesText: string;
  logFile: string;
}

export interface Draft {
  app: { closeBehavior: CloseBehavior; startAtLogin: boolean };
  router: RouterDraft;
  vendors: VendorDraft[];
}

export interface RouterConfig {
  host: string;
  port: number;
  apiKey: string;
  requestTimeoutMs: number;
  maxBodyBytes: number;
  fallbackStatusCodes: number[];
  logFile: string;
}

export interface VendorModelConfig {
  id: string;
  enabled: boolean;
  pricing?:
    | { mode: "custom"; currency: string; inputPerMillion: number; cachedInputPerMillion: number | null; outputPerMillion: number }
    | { mode: "deepseek" };
  enableThinking?: boolean;
}

export interface VendorConfig {
  name: string;
  baseUrl: string;
  models: VendorModelConfig[];
  authentication: Authentication;
  apiKeyHeader: string;
  requestFormat: RequestFormat;
  enabled: boolean;
  apiKey?: string;
  chatCompletionsPath?: string;
  responsesPath?: string;
  [key: string]: unknown;
}

export interface Config {
  app: { closeBehavior: CloseBehavior; startAtLogin: boolean };
  router: RouterConfig;
  vendors: VendorConfig[];
}

export interface ConfigVendorInput {
  name?: string;
  baseUrl?: string;
  model?: string;
  models?: Array<string | Record<string, unknown>>;
  authentication?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  enabled?: boolean;
  requestFormat?: string;
  chatCompletionsPath?: string;
  responsesPath?: string;
  [key: string]: unknown;
}

export interface ConfigInput {
  app?: { closeBehavior?: string; startAtLogin?: boolean };
  router?: {
    host?: string;
    port?: number | string;
    apiKey?: string;
    requestTimeoutMs?: number | string;
    maxBodyBytes?: number;
    fallbackStatusCodes?: number[];
    logFile?: string;
  };
  vendors?: ConfigVendorInput[];
}

export const defaultDraft: Draft = {
  app: { closeBehavior: "tray", startAtLogin: false },
  router: {
    host: "127.0.0.1",
    port: "4000",
    apiKey: "",
    requestTimeoutMs: "30000",
    maxBodyMb: "50",
    maxBodyBytes: 50 * 1024 * 1024,
    fallbackStatusCodesText: "408, 409, 425, 429, 500, 502, 503, 504",
    logFile: "logs/router.log",
  },
  vendors: [],
};

const closeBehaviorValues = new Set<CloseBehavior>(["tray", "exit", "ask"]);
const requestFormatValues = new Set<RequestFormat>(["chat-completions", "responses"]);

export function normalizeRequestFormat(value: unknown): RequestFormat {
  return requestFormatValues.has(value as RequestFormat) ? (value as RequestFormat) : "chat-completions";
}

export function normalizeCloseBehavior(value: unknown): CloseBehavior {
  return closeBehaviorValues.has(value as CloseBehavior) ? (value as CloseBehavior) : defaultDraft.app.closeBehavior;
}

export function normalizeVendorModelsForDraft(vendor: ConfigVendorInput | VendorDraft | null | undefined): VendorModelDraft[] {
  if (!Array.isArray(vendor?.models)) {
    const id = String((vendor as ConfigVendorInput)?.model || "").trim();
    return id ? [{ id, enabled: true }] : [];
  }

  return vendor.models.map((model) => normalizeVendorModelForDraft(model));
}

function normalizeVendorModelForDraft(model: string | Record<string, unknown>): VendorModelDraft {
  if (typeof model === "string") {
    return { id: model.trim(), enabled: true };
  }
  if (!model || typeof model !== "object") {
    return { id: "", enabled: true };
  }

  const hasExplicitId = Object.prototype.hasOwnProperty.call(model, "id");
  const pricingRaw = model.pricing as
    | { mode?: string; currency?: string; inputPerMillion?: number | string; cachedInputPerMillion?: number | string; outputPerMillion?: number | string }
    | undefined;
  const pricing = pricingRaw && ["openai", "deepseek", "custom"].includes(pricingRaw.mode ?? "") ? pricingRaw : null;
  const pricingMode = ["openai", "deepseek", "custom"].includes(model.pricingMode as string)
    ? (model.pricingMode as PricingMode)
    : pricing ? (pricing.mode as PricingMode) : "openai";
  const inputPerMillion = model.inputPerMillion as string | undefined;
  const cachedInputPerMillion = model.cachedInputPerMillion as string | undefined;
  const outputPerMillion = model.outputPerMillion as string | undefined;
  return {
    ...model,
    id: String(hasExplicitId ? model.id || "" : model.model || "").trim(),
    enabled: model.enabled !== false,
    pricingMode,
    pricingCurrency: normalizePricingCurrency((model.pricingCurrency as string | undefined) ?? pricing?.currency),
    inputPerMillion: inputPerMillion ?? (pricing ? String(pricing.inputPerMillion ?? "") : ""),
    cachedInputPerMillion: cachedInputPerMillion ?? (pricing ? String(pricing.cachedInputPerMillion ?? "") : ""),
    outputPerMillion: outputPerMillion ?? (pricing ? String(pricing.outputPerMillion ?? "") : ""),
  };
}

export function getVendorModels(vendor: ConfigVendorInput | VendorDraft | null | undefined): VendorModelDraft[] {
  return normalizeVendorModelsForDraft(vendor);
}

export function toDraft(config: ConfigInput): Draft {
  const app = config.app || {};
  const router = config.router || {};

  return {
    app: {
      closeBehavior: normalizeCloseBehavior(app.closeBehavior),
      startAtLogin: app.startAtLogin === true,
    },
    router: {
      host: router.host || defaultDraft.router.host,
      port: String(router.port ?? 4000),
      apiKey: router.apiKey || "",
      requestTimeoutMs: String(router.requestTimeoutMs ?? 30000),
      // Preserve exact bytes so saving an unrelated field cannot round the value.
      maxBodyMb: formatMegabytes(router.maxBodyBytes),
      maxBodyBytes: Number(router.maxBodyBytes || defaultDraft.router.maxBodyBytes),
      fallbackStatusCodesText: Array.isArray(router.fallbackStatusCodes)
        ? router.fallbackStatusCodes.join(", ")
        : defaultDraft.router.fallbackStatusCodesText,
      logFile: router.logFile || defaultDraft.router.logFile,
    },
    vendors: Array.isArray(config.vendors)
      ? config.vendors.map((vendor) => ({
          ...vendor,
          models: normalizeVendorModelsForDraft(vendor),
          authentication: vendor.authentication === "api-key" || vendor.apiKey ? "api-key" : "none",
          apiKeyHeader: vendor.apiKeyHeader || "authorization",
          requestFormat: normalizeRequestFormat(vendor.requestFormat),
        }))
      : [],
  };
}

export function toConfig(draft: Draft): Config {
  return {
    app: {
      closeBehavior: normalizeCloseBehavior(draft.app?.closeBehavior),
      startAtLogin: draft.app?.startAtLogin === true,
    },
    router: {
      host: draft.router.host.trim() || defaultDraft.router.host,
      port: numberValue(draft.router.port, 4000),
      apiKey: draft.router.apiKey,
      requestTimeoutMs: numberValue(draft.router.requestTimeoutMs, 30000),
      maxBodyBytes: megabytesToBytes(draft.router.maxBodyMb, draft.router.maxBodyBytes),
      fallbackStatusCodes: parseStatusCodes(draft.router.fallbackStatusCodesText),
      logFile: draft.router.logFile.trim() || defaultDraft.router.logFile,
    },
    vendors: draft.vendors.map((vendor) => {
      const normalized: VendorConfig = {
        ...vendor,
        name: String(vendor.name || "").trim(),
        baseUrl: String(vendor.baseUrl || "").trim(),
        models: normalizeVendorModelsForDraft(vendor).map((model) => ({
          id: String(model.id || "").trim(),
          enabled: model.enabled !== false,
          ...(model.pricingMode === "custom" ? {
            pricing: {
              mode: "custom" as const,
              currency: String(model.pricingCurrency || "USD").trim().toUpperCase() || "USD",
              inputPerMillion: requiredNonnegativeNumber(model.inputPerMillion, "Input price"),
              cachedInputPerMillion: optionalNonnegativeNumber(model.cachedInputPerMillion, "Cached input price"),
              outputPerMillion: requiredNonnegativeNumber(model.outputPerMillion, "Output price"),
            },
          } : {}),
          ...(model.pricingMode === "deepseek" ? {
            pricing: { mode: "deepseek" as const },
          } : {}),
          ...(model.enableThinking === true ? { enableThinking: true } : {}),
        })),
        authentication: vendor.authentication === "api-key" ? "api-key" : "none",
        apiKeyHeader: vendor.apiKeyHeader || "authorization",
        requestFormat: normalizeRequestFormat(vendor.requestFormat),
        enabled: vendor.enabled !== false,
      };
      for (const key of ["timeoutMs", "apiKeyEnv", "headers", "model"]) {
        delete normalized[key];
      }
      if (normalized.authentication === "none") {
        delete normalized.apiKey;
      }
      return normalized;
    }),
  };
}

function parseStatusCodes(value: string): number[] {
  const codes = value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const code = Number(item);
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw new Error(`Invalid fallback status code: ${item}`);
    }
    return code;
  });

  if (!codes.length) {
    throw new Error("At least one fallback status code is required.");
  }
  if (new Set(codes).size !== codes.length) {
    throw new Error("Fallback status codes must be unique.");
  }
  return codes;
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatMegabytes(bytes: unknown): string {
  const megabytes = Number(bytes || defaultDraft.router.maxBodyBytes) / 1048576;
  return String(Number(megabytes.toFixed(6)));
}

function megabytesToBytes(value: unknown, fallbackBytes: number): number {
  const megabytes = Number(value);
  return Number.isFinite(megabytes) ? Math.round(megabytes * 1048576) : fallbackBytes;
}

function requiredNonnegativeNumber(value: unknown, label: string): number {
  const text = String(value ?? "").trim();
  const number = Number(text);
  if (!text || !Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return number;
}

function optionalNonnegativeNumber(value: unknown, label: string): number | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  return requiredNonnegativeNumber(text, label);
}

function normalizePricingCurrency(value: unknown): string {
  return String(value || "USD").trim().toUpperCase() === "CNY" ? "CNY" : "USD";
}
