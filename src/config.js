import { z } from "zod";
import { normalizeRequestFormat } from "./openai-protocol.js";

export const DEFAULT_CONFIG = {
  app: {
    closeBehavior: "tray",
    startAtLogin: false,
  },
  router: {
    host: "127.0.0.1",
    port: 4000,
    apiKey: "",
    requestTimeoutMs: 30000,
    maxBodyBytes: 50 * 1024 * 1024,
    fallbackStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
    logFile: "logs/router.log",
  },
  vendors: [],
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const httpUrlSchema = z.string().trim().refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}, "Enter a valid HTTP or HTTPS URL.");

const statusCodeSchema = z.number().int().min(100).max(599);
const closeBehaviorSchema = z.enum(["tray", "exit", "ask"]);
const apiKeyHeaderSchema = z.enum(["authorization", "api-key", "x-api-key"]);
const customPricingSchema = z.object({
  mode: z.literal("custom"),
  currency: z.string().trim().min(1).default("USD"),
  inputPerMillion: z.number().nonnegative(),
  cachedInputPerMillion: z.number().nonnegative().nullable().optional().default(null),
  outputPerMillion: z.number().nonnegative(),
});
const modelPricingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("openai") }),
  z.object({ mode: z.literal("deepseek") }),
  customPricingSchema,
]);

export const vendorModelSchema = z.object({
  id: z.string().trim().optional().default(""),
  enabled: z.boolean().optional().default(true),
  pricing: modelPricingSchema.optional(),
  enableThinking: z.boolean().optional().default(false),
}).passthrough();

export const vendorSchema = z.object({
  name: z.string().trim().optional().default(""),
  baseUrl: z.string().trim().optional().default(""),
  model: z.string().trim().optional(),
  models: z.array(vendorModelSchema).optional().default([]),
  authentication: z.enum(["none", "api-key"]).optional().default("none"),
  apiKeyHeader: apiKeyHeaderSchema.optional().default("authorization"),
  enabled: z.boolean().optional().default(true),
  apiKey: z.string().trim().optional(),
  requestFormat: z.enum(["chat-completions", "responses"]).optional().default("chat-completions"),
  chatCompletionsPath: z.string().trim().optional(),
  responsesPath: z.string().trim().optional(),
}).passthrough().superRefine((vendor, context) => {
  if (vendor.enabled === false) {
    return;
  }

  if (!vendor.name) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["name"],
      message: "Every vendor needs a name.",
    });
  }

  if (!httpUrlSchema.safeParse(vendor.baseUrl).success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseUrl"],
      message: `Vendor ${vendor.name || "(unnamed)"} has an invalid baseUrl.`,
    });
  }

  if (vendor.authentication === "api-key" && !vendor.apiKey) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["apiKey"],
      message: `Vendor ${vendor.name || "(unnamed)"} requires an API key.`,
    });
  }

  vendor.models.forEach((model, index) => {
    if (!model.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["models", index, "id"],
        message: `Vendor ${vendor.name || "(unnamed)"} has a model without an id.`,
      });
    }
  });
});

export const configSchema = z.object({
  app: z.object({
    closeBehavior: closeBehaviorSchema.default(DEFAULT_CONFIG.app.closeBehavior),
    startAtLogin: z.boolean().default(DEFAULT_CONFIG.app.startAtLogin),
  }).default(DEFAULT_CONFIG.app),
  router: z.object({
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65535),
    apiKey: z.string().trim().min(1, "router.apiKey is required."),
    requestTimeoutMs: z.number().int().min(100),
    maxBodyBytes: z.number().int().min(1024),
    fallbackStatusCodes: z.array(statusCodeSchema).min(1),
    logFile: z.string().trim().min(1),
  }),
  vendors: z.array(vendorSchema),
});

export function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = deepMerge(base[key], value);
    }
    return merged;
  }

  return override ?? base;
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && value.constructor === Object;
}

export function normalizeConfig(config) {
  const merged = deepMerge(DEFAULT_CONFIG, isPlainObject(config) ? config : {});
  const app = merged.app || {};
  const router = merged.router || {};

  return {
    app: {
      closeBehavior: normalizeCloseBehavior(app.closeBehavior),
      startAtLogin: app.startAtLogin === true,
    },
    router: {
      host: String(router.host || DEFAULT_CONFIG.router.host).trim() || DEFAULT_CONFIG.router.host,
      port: Number(router.port || DEFAULT_CONFIG.router.port),
      apiKey: String(router.apiKey || ""),
      requestTimeoutMs: Number(router.requestTimeoutMs || DEFAULT_CONFIG.router.requestTimeoutMs),
      maxBodyBytes: Number(router.maxBodyBytes || DEFAULT_CONFIG.router.maxBodyBytes),
      fallbackStatusCodes: normalizeStatusCodes(router.fallbackStatusCodes),
      logFile: String(router.logFile || DEFAULT_CONFIG.router.logFile).trim() || DEFAULT_CONFIG.router.logFile,
    },
    vendors: Array.isArray(merged.vendors) ? merged.vendors.map((vendor) => normalizeVendor(vendor)) : [],
  };
}

function normalizeCloseBehavior(value) {
  return closeBehaviorSchema.safeParse(value).success ? value : DEFAULT_CONFIG.app.closeBehavior;
}

function normalizeStatusCodes(value) {
  const codes = Array.isArray(value) ? value : DEFAULT_CONFIG.router.fallbackStatusCodes;
  return [...new Set(codes.map(Number).filter((code) => Number.isInteger(code) && code >= 100 && code <= 599))];
}

export function normalizeVendor(vendor) {
  const authentication = vendor?.authentication === "api-key" || (!vendor?.authentication && vendor?.apiKey)
    ? "api-key"
    : "none";
  const item = {
    ...vendor,
    name: String(vendor?.name || "").trim(),
    baseUrl: String(vendor?.baseUrl || "").trim(),
    models: normalizeVendorModels(vendor?.models, {
      hasExplicitModels: Array.isArray(vendor?.models),
      legacyModelId: vendor?.model,
    }),
    authentication,
    apiKeyHeader: normalizeApiKeyHeader(vendor?.apiKeyHeader),
    requestFormat: normalizeRequestFormat(vendor?.requestFormat),
    enabled: vendor?.enabled !== false,
  };

  for (const key of ["apiKey", "chatCompletionsPath", "responsesPath"]) {
    if (item[key] !== undefined) {
      item[key] = String(item[key] || "").trim();
      if (!item[key]) {
        delete item[key];
      }
    }
  }

  delete item.timeoutMs;
  delete item.apiKeyEnv;
  delete item.headers;
  delete item.model;

  if (authentication === "none") {
    delete item.apiKey;
  }

  return item;
}

function normalizeApiKeyHeader(value) {
  const header = String(value || "authorization").trim().toLowerCase();
  return apiKeyHeaderSchema.safeParse(header).success ? header : "authorization";
}

export function normalizeVendorModels(value, { hasExplicitModels = Array.isArray(value), legacyModelId = "" } = {}) {
  const legacyId = String(legacyModelId || "").trim();

  if (!hasExplicitModels) {
    return legacyId ? [{ id: legacyId, enabled: true }] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((model) => normalizeVendorModel(model))
    .filter((model) => model.id);
}

function normalizeVendorModel(model) {
  if (typeof model === "string") {
    const id = model.trim();
    return { id, enabled: true };
  }

  const id = String(model?.id || model?.model || "").trim();
  const normalized = {
    ...model,
    id,
    enabled: model?.enabled !== false,
  };
  const pricing = normalizeModelPricing(model?.pricing);
  if (pricing) {
    normalized.pricing = pricing;
  } else {
    delete normalized.pricing;
  }
  if (model?.enableThinking === true) {
    normalized.enableThinking = true;
  } else {
    delete normalized.enableThinking;
  }
  return normalized;
}

function normalizeModelPricing(value) {
  if (!value) {
    return undefined;
  }
  if (value.mode === "openai" || value.mode === "deepseek") {
    return { mode: value.mode };
  }
  if (value.mode !== "custom") {
    return undefined;
  }
  return {
    mode: "custom",
    currency: String(value.currency || "USD").trim().toUpperCase() || "USD",
    inputPerMillion: Number(value.inputPerMillion),
    cachedInputPerMillion: value.cachedInputPerMillion === null || value.cachedInputPerMillion === undefined
      ? null
      : Number(value.cachedInputPerMillion),
    outputPerMillion: Number(value.outputPerMillion),
  };
}

export function validateConfig(config, { requireVendors = true, configPath = "config.json" } = {}) {
  const parsed = configSchema.safeParse(config);
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);

  if (requireVendors && !config.vendors.length) {
    errors.push(
      `No vendors configured. Copy config.example.json to config.json, edit vendors, or set VENDOR_A_* / VENDOR_B_* environment variables. Config path: ${configPath}`,
    );
  }

  if (errors.length) {
    throw new Error(errors.join(" "));
  }
}

export function requiresRouterApiKey(host) {
  const normalized = String(host || "").trim().toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::" || !LOOPBACK_HOSTS.has(normalized);
}