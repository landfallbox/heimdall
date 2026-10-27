// Parser for https://api-docs.deepseek.com/quick_start/pricing.
//
// The page is a single table:
//   - "MODEL" row: the last two cells are the model ids (may carry a "(1)"
//     footnote marker that must be stripped).
//   - "CONTEXT LENGTH" / "MAX OUTPUT": single-value rows (colspan=2) shared
//     by every model.
//   - "THINKING MODE": a shared (colspan=2) row; non-empty means thinking on.
//   - "FEATURES" block: a rowspan of per-feature rows (label, then one value
//     cell per model); only mapped features are kept.
import { parseTokenValue, splitCells, splitRows, splitTables } from "../lib.mjs";

const FEATURE_MAP = {
  "Tool Calls": "toolCalling",
  Vision: "vision",
};

export async function parse(content) {
  const tables = splitTables(content);
  if (tables.length === 0) return {};

  const rows = splitRows(tables[0]).map(splitCells);
  const modelIds = [];
  const shared = { contextWindow: null, maxOutputTokens: null };
  const sharedCapabilities = {};
  const featureCells = []; // { key, values[] }
  let featuresRemaining = 0;

  for (const cells of rows) {
    if (cells.length === 0) continue;

    // Continuation rows of the FEATURES rowspan block: first cell is the
    // feature label, followed by one value cell per model.
    if (featuresRemaining > 0) {
      featuresRemaining -= 1;
      const key = FEATURE_MAP[cells[0].text];
      if (key) featureCells.push({ key, values: cells.slice(1).map((c) => c.text) });
      continue;
    }

    const first = cells[0];
    // Start of the FEATURES block: the "FEATURES" cell spans the whole block
    // and the first row's label sits in the next cell.
    if (first.text === "FEATURES" && first.rowspan > 1) {
      featuresRemaining = first.rowspan - 1;
      const key = FEATURE_MAP[cells[1]?.text];
      if (key) featureCells.push({ key, values: cells.slice(2).map((c) => c.text) });
      continue;
    }

    const label = first.text.toUpperCase();
    if (label === "MODEL") {
      // Ids are the last two cells; strip trailing "(n)" footnote markers.
      for (const cell of cells.slice(-2)) {
        const id = cell.text.replace(/\s*\(\d+\)\s*$/, "").trim();
        if (id) modelIds.push(id);
      }
      continue;
    }
    if (label === "CONTEXT LENGTH" && cells.length === 2) {
      shared.contextWindow = parseTokenValue(cells[1].text);
      continue;
    }
    if (label === "MAX OUTPUT" && cells.length === 2) {
      shared.maxOutputTokens = parseTokenValue(cells[1].text.replace(/^MAXIMUM:\s*/i, ""));
      continue;
    }
    if (label === "THINKING MODE" && cells.length === 2) {
      const value = cells[1].text;
      if (value.length > 0 && !/not supported/i.test(value)) sharedCapabilities.thinking = true;
      continue;
    }
  }

  const models = {};
  modelIds.forEach((id, index) => {
    const model = {};
    if (shared.contextWindow !== null) model.contextWindow = shared.contextWindow;
    if (shared.maxOutputTokens !== null) model.maxOutputTokens = shared.maxOutputTokens;
    const capabilities = { ...sharedCapabilities };
    for (const { key, values } of featureCells) {
      const value = (values[index] ?? "").trim();
      if (!value) continue;
      capabilities[key] = value === "✓" || value === "✔" || value.toLowerCase() === "yes";
    }
    if (Object.keys(capabilities).length > 0) model.capabilities = capabilities;
    models[id] = model;
  });
  return models;
}
