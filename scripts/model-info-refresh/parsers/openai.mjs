// Parser for https://platform.openai.com/docs/models/all (list) plus the
// per-model detail pages (https://platform.openai.com/docs/models/<id>).
//
// Two-stage: parse() extracts the live (non-deprecated) model ids from the
// list page, then fetches each detail page through ctx.fetchText.
//
// Detail pages are card-based (no data tables). The patterns below were
// verified against the live pages; unknown patterns are simply omitted so a
// layout change degrades to fewer fields instead of a parse failure.
import { parseTokenValue } from "../lib.mjs";

const REASONING_EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"];

export async function parse(content, ctx) {
  const entries = extractListEntries(content);
  const models = {};
  for (const { id, displayName } of entries) {
    let detail;
    try {
      detail = await ctx.fetchText(`https://platform.openai.com/docs/models/${id}`);
    } catch (error) {
      ctx.warn?.(`openai: failed to fetch detail page for ${id}: ${error.message}`);
      continue;
    }
    const parsed = parseDetail(detail);
    if (Object.keys(parsed).length === 0) continue;
    // displayName first, matching the key order of the other parsers' output.
    const model = displayName ? { displayName, ...parsed } : parsed;
    models[id] = model;
  }
  return models;
}

// Model cards are <a href="/api/docs/models/<id>"> blocks; deprecated models
// carry a "Deprecated" badge inside the block and are skipped (they remain in
// data/model-info.json as kept-retired entries).
export function extractListEntries(html) {
  const entries = [];
  const re = /<a\s+href="\/api\/docs\/models\/([^"?#]+)"[\s\S]*?<\/a>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const id = match[1];
    const block = match[0];
    if (block.includes(">Deprecated<")) continue;
    if (entries.some((entry) => entry.id === id)) continue;
    const nameMatch = /<div class="font-semibold">([^<]+)<\/div>/.exec(block);
    entries.push({ id, displayName: nameMatch ? nameMatch[1].trim() : null });
  }
  return entries;
}

// Parse one model detail page. Only fields that are present on the page are
// set; absent fields are left undefined so the merge keeps existing values.
export function parseDetail(html) {
  const model = {};

  const context = /<div>([\d,]+) context window<\/div>/.exec(html);
  if (context) {
    const value = parseTokenValue(context[1]);
    if (value !== null) model.contextWindow = value;
  }
  const output = /<div>([\d,]+) max output tokens<\/div>/.exec(html);
  if (output) {
    const value = parseTokenValue(output[1]);
    if (value !== null) model.maxOutputTokens = value;
  }

  const effort = extractReasoningEffort(html);
  const tools = toolsSection(html);
  const image = />Image<\/div><div class="text-xs text-tertiary">([^<]+)<\/div>/.exec(html);

  const capabilities = {};
  if (tools !== null) {
    // Older pages (e.g. gpt-4o) have no Tools section at all; leave the
    // existing value untouched in that case.
    capabilities.toolCalling = /Supported</.test(tools);
  }
  if (image) capabilities.vision = !/^not supported$/i.test(image[1].trim());
  if (effort.length > 0) capabilities.thinking = true;
  if (Object.keys(capabilities).length > 0) model.capabilities = capabilities;
  if (effort.length > 0) model.supportsReasoningEffort = effort;
  return model;
}

// "reasoning.effort supports low, medium, high, xhigh, and max" appears in two
// spellings across pages: <code>reasoning.effort</code> supports <code>low</code>,
// ... and "Reasoning.effort supports: none, low, medium (default), ...".
function extractReasoningEffort(html) {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\(\s*default\s*\)/gi, "");
  const match = /reasoning\.effort\s+supports:?\s+([a-z, and\s]+)/i.exec(text);
  if (!match) return [];
  const levels = match[1]
    .split(/,| and /)
    .map((level) => level.trim())
    .filter((level) => REASONING_EFFORT_LEVELS.includes(level));
  // Preserve the canonical order regardless of the page wording.
  return REASONING_EFFORT_LEVELS.filter((level) => levels.includes(level));
}

// The Tools section runs from the "Tools" section label to the next section
// label (or a bounded window at the end of the page). Returns null when the
// page has no Tools section.
function toolsSection(html) {
  const label = /<div class="flex w-\[200px\]">Tools<\/div>/.exec(html);
  if (!label) return null;
  const start = label.index;
  const next = html.indexOf('w-[200px]', start + label[0].length);
  return html.slice(start, next > start ? next : start + 30000);
}
