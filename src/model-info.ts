import { BUILTIN_MODEL_INFO_DATA } from "./model-info-data.ts";

export type ReasoningEffortLevel = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelInfoCapabilities {
  toolCalling?: boolean;
  vision?: boolean;
  thinking?: boolean;
}

/**
 * Metadata for a single model, keyed by model id. All fields are optional so a
 * partial entry only fills the fields it knows about.
 */
export interface ModelInfo {
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: ModelInfoCapabilities;
  supportsReasoningEffort?: ReasoningEffortLevel[];
}

export interface RemoteModelInfoData {
  schemaVersion: number;
  updatedAt: string;
  models: Record<string, ModelInfo>;
}

// In-memory model metadata. Seeded from the bundled fallback (generated from
// data/model-info.json) and overridden per model by applyModelInfo so remote
// refreshes win while built-in entries stay the offline fallback.
export const MODEL_INFO: {
  updatedAt: string;
  models: Record<string, ModelInfo>;
} = {
  updatedAt: BUILTIN_MODEL_INFO_DATA.updatedAt,
  models: { ...BUILTIN_MODEL_INFO_DATA.models },
};

export function getModelInfo(modelId: unknown): ModelInfo | null {
  const key = String(modelId || "").trim();
  if (!key) {
    return null;
  }
  const entry = MODEL_INFO.models[key] ?? MODEL_INFO.models[key.toLowerCase()];
  return entry && typeof entry === "object" ? entry : null;
}

export function getModelInfoUpdatedAt(): string {
  return MODEL_INFO.updatedAt;
}

/**
 * Merges validated remote model info into the in-memory record. Remote entries
 * win per model; built-in entries are never removed, so the built-in table
 * stays the offline fallback.
 */
export function applyModelInfo(data: RemoteModelInfoData): { applied: number; updatedAt: string } {
  let applied = 0;
  if (data && typeof data === "object") {
    const incoming = typeof data.updatedAt === "string" ? data.updatedAt.trim() : "";
    // A cache/remote payload older than the built-in data (e.g. after an app
    // upgrade shipped newer built-ins) must not downgrade the in-memory record.
    if (incoming && incoming < MODEL_INFO.updatedAt) {
      return { applied: 0, updatedAt: MODEL_INFO.updatedAt };
    }
    if (incoming) {
      MODEL_INFO.updatedAt = incoming;
    }
    if (data.models && typeof data.models === "object") {
      for (const [id, entry] of Object.entries(data.models)) {
        if (!id || !entry || typeof entry !== "object") {
          continue;
        }
        const current = MODEL_INFO.models[id];
        const next: ModelInfo = { ...current, ...entry };
        if (entry.capabilities && current?.capabilities) {
          next.capabilities = { ...current.capabilities, ...entry.capabilities };
        }
        MODEL_INFO.models[id] = next;
        applied += 1;
      }
    }
  }
  return { applied, updatedAt: MODEL_INFO.updatedAt };
}
