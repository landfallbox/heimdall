import { z } from "zod";

// Standalone validation schema for model info payloads. This module must not
// import src/model-info-data.ts (the generated file) so scripts such as
// scripts/generate-model-info-data.mjs can validate data/model-info.json even
// when the generated output is missing.

export const REASONING_EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

export const MODEL_ID_REGEX = /^[a-zA-Z0-9_.:/-]{2,64}$/;

export const NOISE_WORDS = new Set([
  "pricing",
  "overview",
  "documentation",
  "learn-more",
  "contact-us",
  "tokens",
  "input",
  "output",
  "tier",
  "model",
  "models",
  "docs",
  "help",
  "support",
  "faq",
  "terms",
  "privacy",
  "features",
  "solutions",
]);

export function isValidModelId(id: unknown): boolean {
  if (typeof id !== "string") return false;
  if (id.trim() !== id) return false;
  if (!MODEL_ID_REGEX.test(id)) return false;
  if (NOISE_WORDS.has(id.toLowerCase())) return false;
  return true;
}

const capabilitiesSchema = z
  .object({
    toolCalling: z.boolean().optional(),
    vision: z.boolean().optional(),
    thinking: z.boolean().optional(),
  })
  .strict();

const modelInfoEntrySchema = z
  .object({
    displayName: z.string().min(1).optional(),
    contextWindow: z.number().int().min(1000).max(10000000).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    capabilities: capabilitiesSchema.optional(),
    supportsReasoningEffort: z.array(z.enum(REASONING_EFFORT_LEVELS)).min(1).optional(),
  })
  .strict();

export const remoteModelInfoSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().min(1),
  models: z.record(
    z.string().refine(isValidModelId, { message: "Invalid model ID" }),
    modelInfoEntrySchema,
  ),
});

export function parseRemoteModelInfo(value: unknown): {
  schemaVersion: number;
  updatedAt: string;
  models: Record<string, z.infer<typeof modelInfoEntrySchema>>;
} {
  const result = remoteModelInfoSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.length ? issue.path.join(".") : "value"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid remote model info data: ${details}`);
  }
  return result.data;
}
