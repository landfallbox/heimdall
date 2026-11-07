// Parser for https://ai.google.dev/gemini-api/docs/pricing.
//
// The page is either a classic HTML doc or a client-rendered SPA that embeds
// an agent-oriented markdown document inside a <noscript><pre> block.
//
// Each model is an <h2 id="model-id"> (or `## Model {% id="model-id" %}`) section
// containing several tables (standard / batch / flex / priority / contributor);
// the standard table is the first one whose rows are labelled "Input price",
// "Output price (including thinking tokens)" and "Context caching price".
// That three-row shape is what separates text-chat models from image / TTS /
// live / transcribe / embedding / robotics sections, so we only emit models
// that have all three rows (and skip robotics ids). Prices live in the
// "Paid Tier" column and may be a dual price —
// "$2.00 through November 30, 2026. $4.00 starting December 1, 2026." — in
// which case the value active on `now` is selected.
import { splitCells, splitRows, splitTables } from "../lib.mjs";

const INPUT_ROW = /^input price/i;
const OUTPUT_ROW = /^output price \(including thinking tokens\)/i;
const CACHE_ROW = /^context caching price/i;

/**
 * Normalizes a date to local start-of-day for calendar comparison.
 * @param {Date} d
 * @returns {Date}
 */
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Parses a Paid-Tier price cell. Handles dual prices
 * ("$X through <date>. $Y starting <date>") by picking the value active on
 * `now`, and plain / tiered / multi-modality cells by taking the first $ value.
 * @param {unknown} text
 * @param {Date} now
 * @returns {number | null}
 */
export function parseGooglePrice(text, now) {
  if (text == null) return null;
  const s = String(text);
  const through = s.match(/\$(\d+(?:\.\d+)?)\s*(?:\([^)]*\))?\s*through\s+([A-Za-z]+ \d{1,2}, \d{4})/);
  const starting = s.match(/\$(\d+(?:\.\d+)?)\s*(?:\([^)]*\))?\s*starting\s+([A-Za-z]+ \d{1,2}, \d{4})/);
  if (through && starting) {
    const throughPrice = Number(through[1]);
    const startingPrice = Number(starting[1]);
    const startingDate = startOfDay(new Date(starting[2]));
    const today = startOfDay(now);
    return today < startingDate ? throughPrice : startingPrice;
  }
  const first = s.match(/\$(\d+(?:\.\d+)?)/);
  return first ? Number(first[1]) : null;
}

/**
 * Decodes basic HTML entities into plain characters.
 * @param {string} s
 * @returns {string}
 */
function decodeHtmlEntities(s) {
  return s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Parses markdown table rows from a `{% table %}` block.
 * @param {string} tableBlock
 * @returns {string[][]}
 */
function parseMarkdownTableRows(tableBlock) {
  const rowBlocks = tableBlock.split(/\n\s*---\s*\n/);
  return rowBlocks
    .map((block) => {
      const cells = [];
      let currentCell = null;
      for (const line of block.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("* ")) {
          if (currentCell != null) cells.push(currentCell.trim());
          currentCell = trimmed.slice(2);
        } else if (currentCell != null) {
          currentCell += "\n" + trimmed;
        }
      }
      if (currentCell != null) cells.push(currentCell.trim());
      return cells;
    })
    .filter((row) => row.length > 0);
}

/**
 * Parses Google pricing from embedded Markdown format inside `<noscript><pre>`.
 * @param {string} markdown
 * @param {Date} now
 * @returns {Record<string, { currency: string, inputPerMillion: number, cachedInputPerMillion?: number, outputPerMillion: number }>}
 */
function parseMarkdownFormat(markdown, now) {
  const models = {};
  const sectionRegex = /^##\s+.*?\{%\s*id="([^"]+)"\s*%\}/gm;
  const matches = [...markdown.matchAll(sectionRegex)];

  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1];
    if (/robotics|pricing-for|notes/i.test(id)) continue;
    const start = matches[i].index;
    const end = matches[i + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end);

    const tables = [...section.matchAll(/\{% table %\}([\s\S]*?)\{% \/table %\}/g)];
    for (const tableMatch of tables) {
      const rows = parseMarkdownTableRows(tableMatch[1]);
      if (rows.length < 2) continue;
      const labels = rows.map((r) => r[0] ?? "");
      const inputIdx = labels.findIndex((l) => INPUT_ROW.test(l));
      const outputIdx = labels.findIndex((l) => OUTPUT_ROW.test(l));
      const cacheIdx = labels.findIndex((l) => CACHE_ROW.test(l));
      if (inputIdx < 0 || outputIdx < 0 || cacheIdx < 0) continue;

      const paidCol = rows[0].findIndex((c) => /paid tier/i.test(typeof c === "string" ? c : c?.text));
      const col = paidCol >= 0 ? paidCol : rows[0].length - 1;

      const input = parseGooglePrice(rows[inputIdx][col], now);
      const output = parseGooglePrice(rows[outputIdx][col], now);
      const cache = parseGooglePrice(rows[cacheIdx][col], now);
      if (input == null || output == null) continue;

      models[id] = {
        currency: "USD",
        inputPerMillion: input,
        ...(cache != null ? { cachedInputPerMillion: cache } : {}),
        outputPerMillion: output,
      };
      break;
    }
  }
  return models;
}

/**
 * Parses Google pricing from classic HTML documentation.
 * @param {string} content
 * @param {Date} now
 * @returns {Record<string, { currency: string, inputPerMillion: number, cachedInputPerMillion?: number, outputPerMillion: number }>}
 */
function parseHtmlFormat(content, now) {
  const models = {};
  const h2 = [...content.matchAll(/<h2[^>]*\bid="([^"]+)"[^>]*>/g)];
  for (let i = 0; i < h2.length; i++) {
    const id = h2[i][1];
    if (/robotics|pricing-for|notes/i.test(id)) continue;
    const section = content.slice(h2[i].index, h2[i + 1]?.index ?? content.length);

    let entry = null;
    for (const table of splitTables(section)) {
      const rows = splitRows(table).map(splitCells).filter((c) => c.length > 0);
      if (rows.length < 2) continue;
      const labels = rows.map((r) => r[0]?.text ?? "");
      const inputIdx = labels.findIndex((l) => INPUT_ROW.test(l));
      const outputIdx = labels.findIndex((l) => OUTPUT_ROW.test(l));
      const cacheIdx = labels.findIndex((l) => CACHE_ROW.test(l));
      if (inputIdx < 0 || outputIdx < 0 || cacheIdx < 0) continue;

      const paidCol = rows[0].findIndex((c) => /paid tier/i.test(c.text));
      const col = paidCol >= 0 ? paidCol : rows[0].length - 1;

      const input = parseGooglePrice(rows[inputIdx][col]?.text, now);
      const output = parseGooglePrice(rows[outputIdx][col]?.text, now);
      const cache = parseGooglePrice(rows[cacheIdx][col]?.text, now);
      if (input == null || output == null) continue;
      entry = {
        currency: "USD",
        inputPerMillion: input,
        ...(cache != null ? { cachedInputPerMillion: cache } : {}),
        outputPerMillion: output,
      };
      break;
    }
    if (entry) models[id] = entry;
  }
  return models;
}

/**
 * Parses Google Gemini API pricing documentation (supporting both SPA noscript markdown and classic HTML).
 * @param {string} content
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Record<string, { currency: string, inputPerMillion: number, cachedInputPerMillion?: number, outputPerMillion: number }>>}
 */
export async function parse(content, options = {}) {
  const now = options.now ?? new Date();

  // Modern SPA documentation page embeds an agent/markdown payload inside <noscript><pre>.
  const noscriptMatch = content.match(/<noscript[^>]*>\s*<pre[^>]*>([\s\S]*?)<\/pre>\s*<\/noscript>/i);
  if (noscriptMatch) {
    const markdown = decodeHtmlEntities(noscriptMatch[1]);
    const models = parseMarkdownFormat(markdown, now);
    if (Object.keys(models).length > 0) return models;
  }

  // Classic server-rendered HTML documentation.
  return parseHtmlFormat(content, now);
}
