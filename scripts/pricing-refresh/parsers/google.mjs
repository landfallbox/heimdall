// Parser for https://ai.google.dev/gemini-api/docs/pricing.
//
// Each model is an <h2 id="model-id"> section containing several tables
// (standard / batch / flex / priority / contributor); the standard table is
// the first one whose rows are labelled "Input price",
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

// Normalize a date to local start-of-day so "through Nov 30" / "starting Dec 1"
// compare against the calendar day, not the time of day.
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Parse a Paid-Tier price cell. Handles dual prices
// ("$X through <date>. $Y starting <date>") by picking the value active on
// `now`, and plain / tiered / multi-modality cells by taking the first $ value.
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

export async function parse(content, options = {}) {
  const now = options.now ?? new Date();
  const models = {};

  // Split the document into <h2 id="..."> sections.
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

      // Prices are in the "Paid Tier" column (fall back to the last cell).
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
      break; // first matching (standard) table wins
    }
    if (entry) models[id] = entry;
  }
  if (Object.keys(models).length === 0) throw new Error("google: no models parsed");
  return models;
}
