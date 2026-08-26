import { getVendorModels, type ConfigVendorInput, type Draft, type VendorDraft, type VendorModelDraft } from "./config-draft.ts";
import { getCatalogPriceView } from "../../src/usage.js";
import type { LogEntry, Tone, VendorHealth } from "./types.ts";

export interface FieldIssue {
  tone: "error" | "warning";
  message: string;
}

export interface ValidationIssueMap {
  [field: string]: FieldIssue | undefined;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  fields: ValidationIssueMap;
  hasErrors: boolean;
  firstError?: string;
}

export type VendorLike = VendorDraft | ConfigVendorInput | null | undefined;

export function getVendorModelOptions(vendor: VendorLike, availableModels: string[] = []): string[] {
  return [
    ...new Set([
      ...availableModels.map((modelId) => String(modelId || "").trim()).filter(Boolean),
      ...getVendorModels(vendor).map((model) => String(model.id || "").trim()).filter(Boolean),
    ]),
  ];
}

export function getVendorModelsSourceKey(vendor: VendorLike): string {
  return String(vendor?.baseUrl || "").trim();
}

export function validateVendorBaseUrl(value: unknown): string {
  const baseUrl = String(value || "").trim();
  if (!baseUrl) {
    return "Base URL is required.";
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return "Base URL must start with http:// or https://.";
  }

  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Base URL must use HTTP or HTTPS.";
    }
  } catch {
    return "Base URL must be a valid URL, for example http://127.0.0.1:8000/v1.";
  }

  return "";
}

export function getVendorModelsLoadMessage(vendor: VendorLike): string {
  const baseUrlError = validateVendorBaseUrl(vendor?.baseUrl);
  if (baseUrlError) {
    return baseUrlError;
  }
  if (vendor?.authentication === "api-key" && !vendor?.apiKey) {
    return "Enter the Vendor API key before loading models.";
  }
  return "";
}

export function canLoadVendorModels(vendor: VendorLike): boolean {
  if (getVendorModelsLoadMessage(vendor)) {
    return false;
  }
  return vendor?.authentication !== "api-key" || Boolean(vendor?.apiKey);
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validateInteger(value: unknown, label: string, { min, max }: { min: number; max: number }): string {
  const text = String(value ?? "").trim();
  const number = Number(text);
  if (!text || !Number.isInteger(number)) {
    return `${label} must be a whole number.`;
  }
  if (number < min || number > max) {
    return `${label} must be between ${min} and ${max}.`;
  }
  return "";
}

export function validateRouter(router: Draft["router"]): ValidationResult {
  const errors: string[] = [];
  const fields: ValidationIssueMap = {};

  function addError(field: string, message: string) {
    fields[field] = { tone: "error", message };
    errors.push(message);
  }

  const portError = validateInteger(router.port, "Port", { min: 1, max: 65535 });
  if (portError) {
    addError("port", portError);
  }

  return { errors, warnings: [], fields, hasErrors: errors.length > 0, firstError: errors[0] || "" };
}

export function endpointsFromDraft(draft: Draft): { chatCompletions: string; responses: string } {
  const rawHost = draft.router.host.trim() || "127.0.0.1";
  const host = rawHost.includes(":") && !rawHost.startsWith("[") ? `[${rawHost}]` : rawHost;
  const port = numberValue(draft.router.port, 4000);
  const baseUrl = `http://${host}:${port}/v1`;
  return {
    chatCompletions: `${baseUrl}/chat/completions`,
    responses: `${baseUrl}/responses`,
  };
}

export function suggestCatalogSwitch(pricingMode: unknown, modelId: string): "openai" | "deepseek" | null {
  if (pricingMode === "custom" || !modelId) {
    return null;
  }
  if (getCatalogPriceView(pricingMode as "openai" | "deepseek", modelId)) {
    return null;
  }
  const otherKey = pricingMode === "deepseek" ? "openai" : "deepseek";
  return getCatalogPriceView(otherKey, modelId) ? otherKey : null;
}

export function getVendorCircuitSummary(vendorHealth: VendorHealth | undefined): { tone: Tone; label: string } | null {
  const models = Array.isArray(vendorHealth?.models) ? vendorHealth.models : [];
  const openModels = models.filter((model) => model?.circuit?.state === "open");
  const recoveringModels = models.filter((model) => model?.circuit?.state === "half-open");

  if (openModels.length) {
    return {
      tone: "danger",
      label: openModels.length === 1 ? `Circuit open · ${openModels[0].id}` : `Circuit open · ${openModels.length} models`,
    };
  }
  if (recoveringModels.length) {
    return {
      tone: "warning",
      label: recoveringModels.length === 1 ? `Recovering · ${recoveringModels[0].id}` : `Recovering · ${recoveringModels.length} models`,
    };
  }
  return null;
}

export function validateVendor(vendor: VendorLike): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fields: ValidationIssueMap = {};
  const name = String(vendor?.name || "").trim();
  const baseUrl = String(vendor?.baseUrl || "").trim();
  const models = getVendorModels(vendor);
  const enabledModels = models.filter((model) => model.enabled !== false);
  const authentication = vendor?.authentication === "api-key" ? "api-key" : "none";
  const requestFormat = vendor?.requestFormat || "chat-completions";

  if (!name) {
    fields.name = { tone: "error", message: "Name is required." };
    errors.push("Name required");
  }

  const baseUrlError = validateVendorBaseUrl(baseUrl);
  if (baseUrlError) {
    fields.baseUrl = { tone: "error", message: baseUrlError };
    errors.push("Base URL required");
  }

  if (!enabledModels.length) {
    fields.models = { tone: "error", message: "Add at least one enabled model." };
    errors.push("No enabled model");
  } else {
    const seenModelIds = new Set<string>();
    for (const model of enabledModels) {
      if (!model.id) {
        fields.models = { tone: "error", message: "Every enabled model needs a name." };
        errors.push("Invalid model mapping");
        break;
      }
      if (seenModelIds.has(model.id)) {
        fields.models = { tone: "error", message: "Model ids must be unique per vendor." };
        errors.push("Duplicate model id");
        break;
      }
      seenModelIds.add(model.id);
    }
  }

  const invalidPricingModel = models.find((model) => model.pricingMode === "custom" && !isValidCustomPricing(model));
  if (invalidPricingModel) {
    fields.models = {
      tone: "error",
      message: `Enter valid non-negative prices for ${invalidPricingModel.id || "the custom-priced model"}.`,
    };
    errors.push("Invalid model pricing");
  }

  if (authentication === "api-key" && !vendor?.apiKey) {
    fields.apiKey = { tone: "error", message: "Enter the API key required by this vendor." };
    errors.push("Missing key");
  }

  if (!["chat-completions", "responses"].includes(requestFormat)) {
    fields.requestFormat = { tone: "error", message: "Select a supported request format." };
    errors.push("Invalid request format");
  }

  return { errors, warnings, fields, hasErrors: errors.length > 0 };
}

export function getVendorModelsErrorField(error: unknown, vendor: VendorLike): { field: string; message: string } {
  const rawMessage = String((error as { message?: unknown })?.message || error || "Failed to refresh models.");
  const jsonCode = rawMessage.match(/"code"\s*:\s*"([^"]+)"/i)?.[1] || "";
  const code = String((error as { code?: unknown })?.code || jsonCode || "").toUpperCase();
  const message = code ? code.replace(/_/g, " ") : rawMessage.replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "");
  if (code.includes("API_KEY") || code.includes("AUTH") || code.includes("UNAUTHORIZED") || /api key|unauthorized|forbidden/i.test(message)) {
    if (vendor?.authentication !== "api-key") {
      return { field: "authentication", message: "API KEY REQUIRED" };
    }
    return { field: "apiKey", message };
  }
  if (code.startsWith("HTTP_4") || /base url|not found|404|connect|network|fetch|timeout/i.test(message)) {
    return { field: "baseUrl", message };
  }
  return { field: "models", message };
}

export function cloneVendor(vendor: VendorLike): VendorDraft | null {
  return vendor ? JSON.parse(JSON.stringify(vendor)) : null;
}

export function parseLogRows(lines: unknown): LogEntry[] {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line, index): LogEntry => {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const level = String(entry.level || "info").toLowerCase();
        return {
          id: `${index}-${entry.time || ""}-${entry.event || ""}`,
          raw: line,
          time: String(entry.time || ""),
          level,
          tone: level === "error" ? "danger" : level === "warn" ? "warning" : "success",
          event: String(entry.event || "log_event"),
          vendor: String(entry.vendor || ""),
          statusCode: entry.statusCode as number | undefined,
          elapsedMs: entry.elapsedMs as number | undefined,
          totalElapsedMs: entry.totalElapsedMs as number | undefined,
          model: String(entry.model || ""),
          requestId: String(entry.requestId || ""),
          message: String(entry.errorMessage || ""),
        };
      } catch {
        return {
          id: `raw-${index}`,
          raw: line,
          time: "",
          level: "text",
          tone: "neutral",
          event: "log_line",
          vendor: "",
          model: "",
          requestId: "",
          message: line,
        };
      }
    })
    .reverse();
}

export function formatLogTime(value: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function isValidCustomPricing(model: VendorModelDraft): boolean {
  return Boolean(String(model.pricingCurrency || "").trim())
    && isNonnegativeNumber(model.inputPerMillion, false)
    && isNonnegativeNumber(model.cachedInputPerMillion, true)
    && isNonnegativeNumber(model.outputPerMillion, false);
}

function isNonnegativeNumber(value: unknown, optional: boolean): boolean {
  const text = String(value ?? "").trim();
  if (!text) {
    return optional;
  }
  const number = Number(text);
  return Number.isFinite(number) && number >= 0;
}
