// Parser for https://platform.minimaxi.com/docs/guides/text-generation.md
// (Mintlify static markdown; the .com URL redirects to the .cn domain).
//
// Only the "### 支持模型" table is parsed; the URL-configuration and protocol
// tables are outside that section. The context window comes from the
// dedicated table column. A "思考深度可调" phrase in the description marks
// models with thinking and adjustable effort; the effort levels are read
// from the "### 思考深度档位（effort）" section.
import { parseTokenValue } from "../lib.mjs";

const REASONING_EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"];

export async function parse(content) {
  const section = supportedModelsSection(content);
  const effort = extractReasoningEffort(content);
  const models = {};
  for (const [id, contextRaw, description] of tableRows(section)) {
    const model = {};
    const contextWindow = parseTokenValue(contextRaw);
    if (contextWindow !== null) model.contextWindow = contextWindow;
    const supportsEffort = /思考深度可调|思考深度\s*effort/i.test(description);
    const capabilities = {};
    if (/多模态|vision/i.test(description)) capabilities.vision = true;
    if (supportsEffort) capabilities.thinking = true;
    if (Object.keys(capabilities).length > 0) model.capabilities = capabilities;
    if (supportsEffort && effort.length > 0) model.supportsReasoningEffort = effort;
    models[id] = model;
  }
  return models;
}

// The section runs from the "### 支持模型" heading to the next "###" heading.
function supportedModelsSection(content) {
  const heading = /^###\s+支持模型\s*$/m.exec(content);
  if (!heading) throw new Error("支持模型 section not found");
  const rest = content.slice(heading.index + heading[0].length);
  const next = rest.search(/^###\s/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// Data rows of the pipe table: [model name, context window, description].
function tableRows(section) {
  const rows = [];
  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    const cells = trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length < 3) continue;
    // Separator row (| :- | :-: | :- |) and header row.
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    if (/模型名称/.test(cells[0])) continue;
    const id = cells[0].replace(/`/g, "").trim();
    if (!id) continue;
    rows.push([id, cells[1], cells[2]]);
  }
  return rows;
}

// "`effort` 可取 `low`、`medium`、`high`、`xhigh`、`max`" -> the levels in
// canonical order. Thinking cannot be disabled, so "none" is never present.
function extractReasoningEffort(content) {
  const match = /`effort`\s*可取\s*([^。]+)/.exec(content);
  if (!match) return [];
  const found = [];
  const re = /`([a-z]+)`/g;
  let level;
  while ((level = re.exec(match[1])) !== null) {
    if (REASONING_EFFORT_LEVELS.includes(level[1])) found.push(level[1]);
  }
  return REASONING_EFFORT_LEVELS.filter((l) => found.includes(l));
}
