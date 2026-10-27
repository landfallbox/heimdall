// Parser for https://platform.claude.com/docs/en/models/overview.
//
// The overview page is a single table whose first column holds the row labels
// ("Claude API ID", "Context window", "Max output", "Thinking", ...). One
// table column is one model.
import { parseTokenValue, splitCells, splitRows, splitTables } from "../lib.mjs";

export async function parse(content) {
  const tables = splitTables(content);
  if (tables.length === 0) return {};

  const rows = splitRows(tables[0]).map(splitCells);
  const byLabel = new Map();
  for (const cells of rows) {
    if (cells.length === 0) continue;
    byLabel.set(cells[0].text, cells.slice(1));
  }

  const idCells = byLabel.get("Claude API ID") ?? [];
  const contextCells = byLabel.get("Context window") ?? [];
  const outputCells = byLabel.get("Max output") ?? [];
  const thinkingCells = byLabel.get("Thinking") ?? [];

  const models = {};
  for (let i = 0; i < idCells.length; i++) {
    const id = idCells[i].text;
    if (!id) continue;
    const model = {};
    const contextWindow = parseTokenValue(contextCells[i]?.text);
    if (contextWindow !== null) model.contextWindow = contextWindow;
    const maxOutputTokens = parseTokenValue(outputCells[i]?.text);
    if (maxOutputTokens !== null) model.maxOutputTokens = maxOutputTokens;
    if (isAffirmative(thinkingCells[i]?.text)) model.capabilities = { thinking: true };
    models[id] = model;
  }
  return models;
}

// The Thinking cell is parsed, not just checked for presence: an explicit
// negative ("No", "Not supported", ...) means the model does not support
// thinking, while any other non-empty value (e.g. "Adaptive") is treated as
// supported.
const THINKING_NEGATIVE_RE = /\b(no|not supported|unsupported|disabled|none|without)\b/i;

function isAffirmative(text) {
  const value = (text ?? "").trim();
  if (!value) return false;
  return !THINKING_NEGATIVE_RE.test(value);
}
