// Parser for https://mimo.mi.com/static/docs/quick-start/summary/model.md
// (static markdown with embedded HTML tables).
//
// Only the "### Text Generation Model" table is parsed; the ASR, TTS and
// Quick Selection tables are skipped (chat-only scope). The first data row
// lists two model ids in one cell and carries a rowspan="2" capability cell
// that the second row inherits.
import { parseTokenValue, splitCells, splitRows, splitTables } from "../lib.mjs";

export async function parse(content) {
  const section = textGenerationSection(content);
  const tables = splitTables(section);
  if (tables.length === 0) throw new Error("no table found in Text Generation section");
  // Turn <br /> into spaces so multi-line cells read as flat text.
  const table = tables[0].replace(/<br\s*\/?>/gi, " ");

  const models = {};
  // Columns still occupied by a rowspan cell from an earlier row.
  const inherited = new Map(); // column -> { text, remaining }
  for (const row of splitRows(table)) {
    if (row.includes("<th")) continue; // header row
    const cells = splitCells(row);
    const grid = new Array(4).fill("");
    let ci = 0;
    for (let col = 0; col < 4; col++) {
      const pending = inherited.get(col);
      if (pending) {
        grid[col] = pending.text;
        pending.remaining -= 1;
        if (pending.remaining <= 0) inherited.delete(col);
      } else if (ci < cells.length) {
        const cell = cells[ci++];
        grid[col] = cell.text;
        if (cell.rowspan > 1) inherited.set(col, { text: cell.text, remaining: cell.rowspan - 1 });
      }
    }
    const ids = extractIds(grid[0]);
    if (ids.length === 0) continue;
    const model = buildModel(grid[1], grid[2]);
    for (const id of ids) models[id] = model;
  }
  return models;
}

// The section runs from the "### Text Generation Model" heading to the next
// "###" heading (ASR).
function textGenerationSection(content) {
  const heading = /^###\s+Text Generation Model\s*$/m.exec(content);
  if (!heading) throw new Error("Text Generation Model section not found");
  const rest = content.slice(heading.index + heading[0].length);
  const next = rest.search(/^###\s/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// Backtick-quoted model ids in the first cell (a cell may list several).
function extractIds(cellText) {
  const ids = [];
  const re = /`([^`]+)`/g;
  let match;
  while ((match = re.exec(cellText)) !== null) {
    const id = match[1].trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Build the model entry from the Capability Support and Length Limit cells.
function buildModel(capabilityText, lengthText) {
  const model = {};
  const context = /context window:\s*([\d.,]+[kKmM]?)/i.exec(lengthText);
  if (context) {
    const value = parseTokenValue(context[1]);
    if (value !== null) model.contextWindow = value;
  }
  const output = /maximum output:\s*([\d.,]+[kKmM]?)/i.exec(lengthText);
  if (output) {
    const value = parseTokenValue(output[1]);
    if (value !== null) model.maxOutputTokens = value;
  }
  const capabilities = {};
  if (/full-modal understanding|vision/i.test(capabilityText)) capabilities.vision = true;
  if (/deep thinking|thinking/i.test(capabilityText)) capabilities.thinking = true;
  if (/function call|tool calling/i.test(capabilityText)) capabilities.toolCalling = true;
  if (Object.keys(capabilities).length > 0) model.capabilities = capabilities;
  return model;
}
