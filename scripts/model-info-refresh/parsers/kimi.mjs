// Parser for https://platform.kimi.ai/docs/models.md (static markdown).
//
// Only the "## Multi-modal Model" table is current; the "## Deprecated Models"
// section is skipped entirely. Context window comes from the description text
// ("1M-token context window", "Context 256k").
import { parseTokenValue } from "../lib.mjs";

export async function parse(content) {
  // Cut off the deprecated section so its table rows are never considered.
  const deprecatedIndex = content.search(/^##\s+Deprecated Models/m);
  const section = deprecatedIndex === -1 ? content : content.slice(0, deprecatedIndex);

  const models = {};
  const rowRe = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*$/gm;
  let match;
  while ((match = rowRe.exec(section)) !== null) {
    const id = match[1].trim();
    const description = match[2].trim();
    if (!id || description.toLowerCase() === "deprecated") continue;

    const model = {};
    const contextWindow = extractContextWindow(description);
    if (contextWindow !== null) model.contextWindow = contextWindow;

    const capabilities = {};
    if (/visual understanding|visual and text input|vision/i.test(description)) {
      capabilities.vision = true;
    }
    if (/thinking/i.test(description)) {
      capabilities.thinking = true;
    }
    if (Object.keys(capabilities).length > 0) model.capabilities = capabilities;
    models[id] = model;
  }
  return models;
}

// "a 1M-token context window" -> 1M; "Context 256k" -> 256k.
function extractContextWindow(description) {
  const tokenMatch = /(\d+(?:\.\d+)?\s*[kKmM])\s*-?\s*token/i.exec(description);
  if (tokenMatch) return parseTokenValue(tokenMatch[1]);
  const contextMatch = /context\s+(\d+(?:\.\d+)?\s*[kKmM])/i.exec(description);
  if (contextMatch) return parseTokenValue(contextMatch[1]);
  return null;
}
