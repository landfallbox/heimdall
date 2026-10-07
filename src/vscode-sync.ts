import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getRouterBaseUrl } from "./router-urls.ts";
import { isPlainObject, type NormalizedConfig, type NormalizedVendorModel } from "./config.ts";

/**
 * The provider entry heimdall owns inside VS Code's chatLanguageModels.json.
 * VS Code may keep other providers (for example its own "Copilot" provider) in
 * the same file; those are never touched.
 */
export const VSCODE_PROVIDER_NAME = "Heimdall";

export interface VsCodeModelEntry {
  id: string;
  /** Display name; omitted when the user has not set one (merge then keeps the existing value). */
  name?: string;
  wireModel: string;
  url: string;
  toolCalling?: boolean;
  vision?: boolean;
  thinking?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsReasoningEffort?: string[];
  [key: string]: unknown;
}

export interface VsCodeSyncResult {
  ok: boolean;
  filePath: string;
  modelCount: number;
  createdProvider: boolean;
  error?: string;
}

/**
 * Resolves the path to VS Code's chatLanguageModels.json. The location follows
 * VS Code's per-platform User settings directory. HEIMDALL_VSCODE_MODELS_FILE
 * overrides the path, which also makes the behaviour easy to test.
 */
export function resolveVsCodeModelsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = String(env.HEIMDALL_VSCODE_MODELS_FILE || "").trim();
  if (override) {
    return override;
  }

  if (process.platform === "win32") {
    const appData = String(env.APPDATA || "").trim();
    if (appData) {
      return join(appData, "Code", "User", "chatLanguageModels.json");
    }
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Code", "User", "chatLanguageModels.json");
  }

  return join(homedir(), ".config", "Code", "User", "chatLanguageModels.json");
}

/**
 * Builds the model entries that should be exposed to VS Code for the given
 * config: every enabled model of every enabled vendor, deduplicated by id.
 * Only metadata the user actually filled in is emitted, so a partial entry
 * never clobbers richer metadata already present in the VS Code file.
 */
export function buildVsCodeModelEntries(config: NormalizedConfig): VsCodeModelEntry[] {
  const url = `${getRouterBaseUrl(config)}/v1`;
  const seen = new Set<string>();
  const entries: VsCodeModelEntry[] = [];

  for (const vendor of config.vendors) {
    if (vendor.enabled === false) {
      continue;
    }
    for (const model of vendor.models) {
      if (model.enabled === false || seen.has(model.id)) {
        continue;
      }
      seen.add(model.id);
      entries.push(toModelEntry(model, url));
    }
  }

  return entries;
}

function toModelEntry(model: NormalizedVendorModel, url: string): VsCodeModelEntry {
  const vscode = model.vscode || {};
  // id / wireModel / url are structural and always written. name and the other
  // metadata are only written when the user filled them in, so a partial entry
  // never clobbers richer metadata already present in the VS Code file.
  const entry: VsCodeModelEntry = {
    id: model.id,
    wireModel: model.id,
    url,
  };
  if (vscode.name) {
    entry.name = vscode.name;
  }
  if (typeof vscode.toolCalling === "boolean") {
    entry.toolCalling = vscode.toolCalling;
  }
  if (typeof vscode.vision === "boolean") {
    entry.vision = vscode.vision;
  }
  if (typeof vscode.thinking === "boolean") {
    entry.thinking = vscode.thinking;
  }
  if (Number.isInteger(vscode.contextWindow) && (vscode.contextWindow as number) > 0) {
    entry.contextWindow = vscode.contextWindow;
  }
  if (Number.isInteger(vscode.maxOutputTokens) && (vscode.maxOutputTokens as number) > 0) {
    entry.maxOutputTokens = vscode.maxOutputTokens;
  }
  if (Array.isArray(vscode.supportsReasoningEffort) && vscode.supportsReasoningEffort.length) {
    entry.supportsReasoningEffort = [...vscode.supportsReasoningEffort];
  }
  return entry;
}

/**
 * Pure merge of the heimdall model entries into the parsed VS Code file.
 *
 * - Other providers are preserved verbatim.
 * - The Heimdall provider is created if missing.
 * - Existing per-model metadata is kept; heimdall only overrides the fields it
 *   explicitly provides.
 * - Models that are no longer enabled in heimdall are dropped from the provider.
 * - A VS Code secret reference for apiKey (`${input:...}`) is never replaced.
 */
export function mergeVsCodeModelsFile(
  existing: unknown,
  entries: VsCodeModelEntry[],
  options: { apiKey?: string } = {},
): { providers: Record<string, unknown>[]; createdProvider: boolean } {
  let providers: Record<string, unknown>[];
  if (existing == null) {
    providers = [];
  } else if (Array.isArray(existing)) {
    providers = existing.filter((item): item is Record<string, unknown> => isPlainObject(item));
  } else {
    throw new Error("chatLanguageModels.json must contain a JSON array of providers.");
  }

  let provider = providers.find((item) => item.name === VSCODE_PROVIDER_NAME);
  let createdProvider = false;
  if (!provider) {
    provider = {
      name: VSCODE_PROVIDER_NAME,
      vendor: "customendpoint",
      apiType: "chat-completions",
      models: [],
    };
    if (options.apiKey) {
      provider.apiKey = options.apiKey;
    }
    providers.push(provider);
    createdProvider = true;
  }

  applyApiKey(provider, options.apiKey);

  const existingModels = Array.isArray(provider.models)
    ? (provider.models as unknown[]).filter((item): item is Record<string, unknown> => isPlainObject(item))
    : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const model of existingModels) {
    if (typeof model.id === "string" && model.id) {
      byId.set(model.id, model);
    }
  }

  const mergedModels: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const current = byId.get(entry.id);
    if (current) {
      mergedModels.push({ ...current, ...entry });
    } else {
      const fresh: Record<string, unknown> = { ...entry };
      if (typeof fresh.name !== "string" || !fresh.name) {
        fresh.name = entry.id;
      }
      mergedModels.push(fresh);
    }
  }

  provider.models = mergedModels;
  return { providers, createdProvider };
}

function applyApiKey(provider: Record<string, unknown>, apiKey: string | undefined): void {
  if (!apiKey) {
    return;
  }
  const current = provider.apiKey;
  // Never replace a VS Code secret reference; opaque secrets cannot be updated
  // from outside VS Code.
  if (typeof current === "string" && current.startsWith("${input:")) {
    return;
  }
  provider.apiKey = apiKey;
}

export async function readVsCodeModelsFile(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

/**
 * Writes the merged provider list back to the VS Code file atomically.
 */
export async function writeVsCodeModelsFile(filePath: string, providers: Record<string, unknown>[]): Promise<void> {
  const text = `${JSON.stringify(providers, null, 2)}\n`;
  const temporaryPath = join(dirname(filePath), `.chatLanguageModels-${randomUUID()}.tmp`);
  const handle = await fs.open(temporaryPath, "wx");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => null);
    throw error;
  }
}

/**
 * Reads, merges, and writes the VS Code model file. Returns a structured result
 * instead of throwing for expected failures so callers can surface a friendly
 * message.
 */
export async function syncVsCodeModels(
  config: NormalizedConfig,
  options: { filePath?: string } = {},
): Promise<VsCodeSyncResult> {
  const filePath = options.filePath || resolveVsCodeModelsFilePath();
  try {
    const existing = await readVsCodeModelsFile(filePath);
    const entries = buildVsCodeModelEntries(config);
    const { providers, createdProvider } = mergeVsCodeModelsFile(existing, entries, {
      apiKey: config.router?.apiKey,
    });
    await writeVsCodeModelsFile(filePath, providers);
    return { ok: true, filePath, modelCount: entries.length, createdProvider };
  } catch (error) {
    return {
      ok: false,
      filePath,
      modelCount: 0,
      createdProvider: false,
      error: (error as Error).message || String(error),
    };
  }
}
