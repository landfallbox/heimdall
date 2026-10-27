// Parser for https://ai.google.dev/gemini-api/docs/models (list) plus the
// per-model detail pages (https://ai.google.dev/gemini-api/docs/models/<id>).
//
// Two-stage: parse() extracts the live model ids from the list page, then
// fetches each detail page through ctx.fetchText.
import { parseTokenValue, splitCells, splitRows, splitTables } from "../lib.mjs";

const CAPABILITY_MAP = {
  "Function calling": "toolCalling",
  "Inputs containing image": "vision",
  Thinking: "thinking",
};

export async function parse(content, ctx) {
  const ids = extractListIds(content);
  const models = {};
  for (const id of ids) {
    let detail;
    try {
      detail = await ctx.fetchText(`https://ai.google.dev/gemini-api/docs/models/${id}`);
    } catch (error) {
      ctx.warn?.(`google: failed to fetch detail page for ${id}: ${error.message}`);
      continue;
    }
    const model = parseDetail(detail);
    if (Object.keys(model).length > 0) models[id] = model;
  }
  return models;
}

// Live models are the rows whose first cell links to a detail page. Shut-down
// models have a "(Shut down)" suffix and no link.
export function extractListIds(html) {
  const ids = [];
  for (const table of splitTables(html)) {
    const rows = splitRows(table);
    for (const row of rows) {
      const cells = splitCells(row);
      if (cells.length === 0) continue;
      const nameCell = cells[0];
      if (nameCell.text.includes("Shut down")) continue;
      // Detail links may be relative ("/gemini-api/...") or absolute
      // ("https://ai.google.dev/gemini-api/...?hl=...").
      const linkMatch = /href="(?:https?:\/\/ai\.google\.dev)?\/gemini-api\/docs\/models\/([^"?#]+)/.exec(nameCell.html);
      if (!linkMatch) continue;
      const id = linkMatch[1];
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

// Parse one gemini-api-model-table detail page.
export function parseDetail(html) {
  const model = {};
  for (const table of splitTables(html)) {
    if (!table.includes("gemini-api-model-table")) continue;
    for (const row of splitRows(table)) {
      const cells = splitCells(row);
      // Label cells embed an aria-hidden icon span whose text pollutes the
      // label, so match with includes rather than a prefix test.
      const label = cells[0]?.text ?? "";
      const valueHtml = cells[1]?.html ?? "";
      if (label.includes("Token limits")) {
        const input = sectionValue(valueHtml, "Input token limit");
        const output = sectionValue(valueHtml, "Output token limit");
        const contextWindow = input !== null ? parseTokenValue(input) : null;
        if (contextWindow !== null) model.contextWindow = contextWindow;
        const maxOutputTokens = output !== null ? parseTokenValue(output) : null;
        if (maxOutputTokens !== null) model.maxOutputTokens = maxOutputTokens;
      } else if (label.includes("Supported data types")) {
        // Vision means image *input*; "Image generation" in Capabilities is
        // output-only and must not count.
        const inputs = sectionValue(valueHtml, "Inputs");
        if (inputs !== null && /image/i.test(inputs)) {
          model.capabilities = { ...model.capabilities, vision: true };
        }
      } else if (label.includes("Capabilities")) {
        // Merge into existing capabilities: the "Supported data types" row
        // (vision) may have been seen before this row.
        const capabilities = { ...model.capabilities };
        for (const [sectionLabel, supported] of capabilitySections(valueHtml)) {
          const key = CAPABILITY_MAP[sectionLabel];
          if (key && !(key in capabilities)) capabilities[key] = supported;
        }
        if (Object.keys(capabilities).length > 0) model.capabilities = capabilities;
      }
    }
  }
  return model;
}

// "<p><b>Label</b></p><p>value</p>" -> value (tag-stripped).
function sectionValue(html, label) {
  const re = new RegExp(`<b>\\s*${escapeRegExp(label)}\\s*</b>\\s*</p>\\s*<p[^>]*>([\\s\\S]*?)</p>`);
  const match = re.exec(html);
  if (!match) return null;
  const text = match[1].replace(/<[^>]*>/g, "").trim();
  return text.length > 0 ? text : null;
}

// Capability sections: "<p><b><a ...>Label</a></b></p><p><span class="gemini-api-supported|not-supported">...</span></p>".
function* capabilitySections(html) {
  const re = /<b>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/b>\s*<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const label = match[1].replace(/<[^>]*>/g, "").trim();
    const supported = /gemini-api-supported/.test(match[2]) && !/gemini-api-not-supported/.test(match[2]);
    yield [label, supported];
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
