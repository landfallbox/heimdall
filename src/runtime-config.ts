import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig, validateConfig, type NormalizedConfig, type NormalizedVendor, type NormalizedVendorModel } from "./config.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(moduleDirectory, "..");
export const runtimeRoot = process.env.HEIMDALL_DATA_DIR || projectRoot;

export type RuntimeVendorModel = NormalizedVendorModel & {
  id: string;
  enabled: boolean;
  enableThinking?: boolean;
};

export type RuntimeVendor = NormalizedVendor & {
  priority: number;
  timeoutMs: number;
  models: RuntimeVendorModel[];
};

export type RuntimeConfig = Omit<NormalizedConfig, "vendors"> & {
  vendors: RuntimeVendor[];
};

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Loads file configuration, applies environment overrides, then validates the runtime shape. */
export function loadRuntimeConfig(): { config: RuntimeConfig; configPath: string } {
  const configPath = process.env.ROUTER_CONFIG || resolve(projectRoot, "config.json");
  const fileConfig = existsSync(configPath) ? readJsonFile(configPath) : {};
  const config = normalizeConfig(fileConfig);

  config.router.host = process.env.HOST || process.env.ROUTER_HOST || config.router.host;
  config.router.port = Number(process.env.PORT || process.env.ROUTER_PORT || config.router.port);
  config.router.apiKey = process.env.ROUTER_API_KEY ?? config.router.apiKey;

  const sourceVendors: NormalizedVendor[] = config.vendors.length ? config.vendors : vendorsFromEnvironment();
  const runtimeVendors: RuntimeVendor[] = sourceVendors
    .map((vendor, priority) => ({ ...vendor, priority }))
    .filter((vendor) => vendor.enabled !== false)
    .map((vendor) => ({
      ...vendor,
      models: normalizeRuntimeVendorModels(vendor, config.model.id),
      timeoutMs: Number(config.router.requestTimeoutMs),
    }))
    .filter((vendor) => vendor.models.some((model) => model.enabled !== false));

  const runtimeConfig: RuntimeConfig = { ...config, vendors: runtimeVendors };
  validateConfig(runtimeConfig, { configPath });
  return { config: runtimeConfig, configPath };
}

function normalizeRuntimeVendorModels(vendor: NormalizedVendor, defaultModelId: string): RuntimeVendorModel[] {
  const models = Array.isArray(vendor.models) ? vendor.models : [];
  if (!models.length) {
    const id = String(vendor.model || defaultModelId || "model-id").trim();
    const model: RuntimeVendorModel = { id, enabled: true };
    if (vendor.enableThinking === true) {
      model.enableThinking = true;
    }
    return [model];
  }

  return models
    .map((model) => ({
      ...model,
      id: String(model.id || defaultModelId || "model-id").trim(),
      enabled: model.enabled !== false,
    }))
    .filter((model) => model.id);
}

function vendorsFromEnvironment(): NormalizedVendor[] {
  return [vendorFromEnvironment("VENDOR_A", "vendor-a"), vendorFromEnvironment("VENDOR_B", "vendor-b")]
    .filter((vendor): vendor is NormalizedVendor => vendor !== null);
}

function vendorFromEnvironment(prefix: string, fallbackName: string): NormalizedVendor | null {
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const apiKey = process.env[`${prefix}_API_KEY`];
  if (!baseUrl && !apiKey) {
    return null;
  }

  return {
    name: process.env[`${prefix}_NAME`] || fallbackName,
    baseUrl: baseUrl ?? "",
    models: [],
    apiKeyHeader: "authorization",
    apiKey: apiKey ?? undefined,
    model: process.env[`${prefix}_MODEL`] || "model-id",
    requestFormat: process.env[`${prefix}_REQUEST_FORMAT`] === "responses" ? "responses" : "chat-completions",
    authentication: apiKey ? "api-key" : "none",
    enabled: true,
    enableThinking: process.env[`${prefix}_ENABLE_THINKING`] === "1",
  };
}
