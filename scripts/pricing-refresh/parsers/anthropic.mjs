// Parser for https://platform.claude.com/docs/en/about-claude/pricing.
//
// The page renders several <table> blocks. The one whose first header row
// contains "Base tokens" is the main pricing table; a "Batch tokens" table
// (half prices) and a "Tool use system prompt tokens" table also exist and
// must be ignored. The main table's first two rows are headers: a 3-cell
// group header and a 6-cell column header —
//   Name | Input | Output | 5m writes | 1h writes | Hits and refreshes
// — where "Hits and refreshes" is the cache-read price. Data rows carry the
// model id as a slug link (href="/docs/en/models/<slug>/overview") in the
// first cell. A few retired models have no slug link and are mapped by their
// exact display name. Tiered-continuation rows (e.g. Haiku 5.5 >100k tier)
// have fewer than 6 cells because the name cell is row-spanned, so they are
// skipped and only the base tier is emitted.
import { parseUsd, splitCells, splitRows, splitTables } from "../lib.mjs";

// Retired models with no slug link, keyed by exact display name.
const NAME_ALIASES = {
  "Claude Opus 4.1": "claude-opus-4-1",
  "Claude Sonnet 4": "claude-sonnet-4",
  "Claude Haiku 3.5": "claude-3-5-haiku",
};

const SLUG = /href="\/docs\/en\/models\/([^/]+)\/overview"/;

export async function parse(content) {
  const models = {};
  for (const table of splitTables(content)) {
    const rows = splitRows(table).map(splitCells).filter((c) => c.length > 0);
    if (rows.length < 3) continue;
    // Only the main table's group header row contains "Base tokens".
    if (!rows[0].some((c) => /base tokens/i.test(c.text))) continue;

    const header = rows[1].map((c) => c.text.trim());
    const inputCol = header.findIndex((h) => /^input$/i.test(h));
    const outputCol = header.findIndex((h) => /^output$/i.test(h));
    const cacheCol = header.findIndex((h) => /hits and refreshes/i.test(h));
    if (inputCol < 0 || outputCol < 0) continue;

    for (const cells of rows.slice(2)) {
      if (cells.length < 6) continue; // tier continuation / section header
      const nameHtml = cells[0]?.html ?? "";
      const slug = nameHtml.match(SLUG);
      // Retired-model rows carry a trailing PUA icon glyph (U+E000–U+F8FF)
      // after the display name; strip it so the alias key matches.
      const name = (cells[0]?.text ?? "")
        .replace(/[\uE000-\uF8FF]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const id = slug ? `claude-${slug[1]}` : NAME_ALIASES[name];
      if (!id) continue;
      const input = parseUsd(cells[inputCol]?.text);
      const output = parseUsd(cells[outputCol]?.text);
      if (input == null || output == null) continue;
      const cache = cacheCol >= 0 ? parseUsd(cells[cacheCol]?.text) : null;
      if (models[id]) continue; // first occurrence wins
      models[id] = {
        currency: "USD",
        inputPerMillion: input,
        ...(cache != null ? { cachedInputPerMillion: cache } : {}),
        outputPerMillion: output,
      };
    }
    break; // only the main table
  }
  if (Object.keys(models).length === 0) throw new Error("anthropic: no models parsed");
  return models;
}
