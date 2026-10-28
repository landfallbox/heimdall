import { getVendorModels, type ConfigVendorInput, type Draft, type PricingMode, type VendorDraft, type VendorModelDraft, type VendorModelVsCodeDraft, type VendorModelVsCodeModelCache } from "./config-draft.ts";
import { getCatalogPriceView, isPricingCatalogKey, PRICING_CATALOG_KEYS } from "../../src/usage.ts";
import { getModelInfo, type ModelInfo } from "../../src/model-info.ts";
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

export function suggestCatalogSwitch(pricingMode: unknown, modelId: string): PricingMode | null {
  if (pricingMode === "custom" || !modelId) {
    return null;
  }
  if (isPricingCatalogKey(pricingMode) && getCatalogPriceView(pricingMode, modelId)) {
    return null;
  }
  for (const key of PRICING_CATALOG_KEYS.filter((value) => value !== pricingMode)) {
    if (getCatalogPriceView(key, modelId)) {
      return key;
    }
  }
  return null;
}

export interface ModelSwitchResult {
  vscode: VendorModelVsCodeDraft | undefined;
  vscodeModelCache?: Record<string, VendorModelVsCodeModelCache>;
  pricingMode?: PricingMode;
  pricingCurrency?: string;
  inputPerMillion?: string;
  cachedInputPerMillion?: string;
  outputPerMillion?: string;
}

/**
 * Computes the row state after switching a model row from `oldId` to `newId`.
 * The outgoing row's VS Code section and custom pricing are snapshotted into
 * the per-model cache (keyed by the old id) so an unsaved row can be switched
 * back without losing edits. If the incoming id has a snapshot it is restored;
 * otherwise the VS Code section is filled fresh from the model info and the
 * custom pricing fields are cleared.
 */
export function applyModelSwitch(
  model: VendorModelDraft,
  newId: string,
  info: ModelInfo | null,
): ModelSwitchResult {
  const oldId = String(model.id || "").trim();
  const cache = { ...(model.vscodeModelCache || {}) };
  const result: ModelSwitchResult = { vscode: undefined };

  if (oldId && oldId !== newId) {
    const snapshot: VendorModelVsCodeModelCache = {};
    if (model.vscode && Object.keys(model.vscode).length) {
      snapshot.vscode = { ...model.vscode };
    }
    if (model.pricingMode === "custom") {
      const pricing: NonNullable<VendorModelVsCodeModelCache["customPricing"]> = {};
      const currency = String(model.pricingCurrency ?? "").trim();
      const input = String(model.inputPerMillion ?? "");
      const cached = String(model.cachedInputPerMillion ?? "");
      const output = String(model.outputPerMillion ?? "");
      if (currency) pricing.currency = currency;
      if (input) pricing.inputPerMillion = input;
      if (cached) pricing.cachedInputPerMillion = cached;
      if (output) pricing.outputPerMillion = output;
      if (Object.keys(pricing).length) {
        snapshot.pricingMode = "custom";
        snapshot.customPricing = pricing;
      }
    }
    if (Object.keys(snapshot).length) {
      cache[oldId] = { ...cache[oldId], ...snapshot };
    }
  }

  const stored = newId ? cache[newId] : undefined;
  if (stored) {
    delete cache[newId];
    result.vscode = stored.vscode ? { ...stored.vscode } : undefined;
    if (stored.pricingMode) {
      result.pricingMode = stored.pricingMode;
    }
    if (stored.customPricing) {
      if (stored.customPricing.currency) {
        result.pricingCurrency = stored.customPricing.currency;
      }
      result.inputPerMillion = stored.customPricing.inputPerMillion ?? "";
      result.cachedInputPerMillion = stored.customPricing.cachedInputPerMillion ?? "";
      result.outputPerMillion = stored.customPricing.outputPerMillion ?? "";
    }
  } else {
    const next: VendorModelVsCodeDraft = {};
    const setIfEmpty = (key: keyof VendorModelVsCodeDraft, val: unknown) => {
      const current = next[key];
      if (val !== undefined && (current === undefined || current === "")) {
        (next as Record<string, unknown>)[key] = val;
      }
    };
    setIfEmpty("name", info?.displayName);
    setIfEmpty("contextWindow", info?.contextWindow != null ? String(info.contextWindow) : undefined);
    setIfEmpty("maxOutputTokens", info?.maxOutputTokens != null ? String(info.maxOutputTokens) : undefined);
    setIfEmpty("toolCalling", info?.capabilities?.toolCalling);
    setIfEmpty("vision", info?.capabilities?.vision);
    setIfEmpty("thinking", info?.capabilities?.thinking);
    if (info?.supportsReasoningEffort?.length) {
      next.supportsReasoningEffort = info.supportsReasoningEffort;
    }
    result.vscode = Object.keys(next).length ? next : undefined;
    result.inputPerMillion = "";
    result.cachedInputPerMillion = "";
    result.outputPerMillion = "";
  }

  if (Object.keys(cache).length) {
    result.vscodeModelCache = cache;
  }
  return result;
}

/**
 * Builds new vendor model rows for bulk "add all models". Each row is built
 * with the same field set as selecting a model in an existing row
 * (ModelPricingRow onValueChange): catalog pricing is auto-suggested when a
 * catalog covers the model id, and the VS Code section is filled from the
 * model info when available. Duplicates and blank ids are dropped.
 */
export function buildBulkVendorModels(modelIds: string[]): VendorModelDraft[] {
  const seen = new Set<string>();
  const rows: VendorModelDraft[] = [];
  for (const raw of modelIds) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const row: VendorModelDraft = { id, enabled: true };
    const switchTo = suggestCatalogSwitch(row.pricingMode, id);
    if (switchTo) {
      row.pricingMode = switchTo;
    }
    const next = applyModelSwitch(row, id, getModelInfo(id));
    if (next.pricingMode) {
      row.pricingMode = next.pricingMode;
    }
    if (next.pricingCurrency !== undefined) {
      row.pricingCurrency = next.pricingCurrency;
    }
    if (next.vscodeModelCache) {
      row.vscodeModelCache = next.vscodeModelCache;
    }
    row.vscode = next.vscode;
    row.inputPerMillion = next.inputPerMillion ?? "";
    row.cachedInputPerMillion = next.cachedInputPerMillion ?? "";
    row.outputPerMillion = next.outputPerMillion ?? "";
    rows.push(row);
  }
  return rows;
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

  {
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

  if (!["chat-completions", "responses", "embeddings", "custom"].includes(requestFormat)) {
    fields.requestFormat = { tone: "error", message: "Select a supported request format." };
    errors.push("Invalid request format");
  }

  return { errors, warnings, fields, hasErrors: errors.length > 0 };
}

export function formatUserErrorMessage(error: unknown, fallback = "An unexpected error occurred."): string {
  if (!error) {
    return fallback;
  }

  const rawMessage = String((error as { message?: unknown })?.message || error || "").trim();
  if (!rawMessage) {
    return fallback;
  }

  let cleaned = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^(?:Uncaught\s+)?(?:TypeError|Error):\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();

  const jsonMsg = cleaned.match(/"message"\s*:\s*"([^"]+)"/i)?.[1];
  if (jsonMsg) {
    cleaned = jsonMsg;
  }

  if (/fetch failed/i.test(cleaned) || /failed to fetch/i.test(cleaned)) {
    return "Network request failed. Check your network connection and try again.";
  }
  if (/ECONNREFUSED/i.test(cleaned) || /connection refused/i.test(cleaned)) {
    return "Connection refused. The server or service is not reachable.";
  }
  if (/ENOTFOUND/i.test(cleaned) || /getaddrinfo/i.test(cleaned)) {
    return "Server address could not be resolved. Check your network connection.";
  }
  if (/ETIMEDOUT/i.test(cleaned) || /timed?\s*out/i.test(cleaned) || /AbortError/i.test(cleaned)) {
    return "Request timed out. Please check your network and try again.";
  }
  if (/ECONNRESET/i.test(cleaned) || /socket hang up/i.test(cleaned)) {
    return "Connection was reset by the server. Please try again.";
  }
  if (/EACCES/i.test(cleaned) || /EPERM/i.test(cleaned) || /permission denied/i.test(cleaned)) {
    return "Permission denied. Check file or folder permissions.";
  }
  if (/ENOENT/i.test(cleaned) || /no such file or directory/i.test(cleaned)) {
    return "File or directory not found.";
  }

  return cleaned || fallback;
}

export function getVendorModelsErrorField(error: unknown, vendor: VendorLike): { field: string; message: string } {
  const rawMessage = String((error as { message?: unknown })?.message || error || "Failed to refresh models.");
  const jsonCode = rawMessage.match(/"code"\s*:\s*"([^"]+)"/i)?.[1] || "";
  const code = String((error as { code?: unknown })?.code || jsonCode || "").toUpperCase();
  const message = code ? code.replace(/_/g, " ") : formatUserErrorMessage(error, rawMessage);
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
