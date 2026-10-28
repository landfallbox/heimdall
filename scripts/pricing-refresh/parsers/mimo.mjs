// Parser for https://mimo.mi.com/static/docs/price/pay-as-you-go.md
//
// The page has a "### Domestic Pricing" section (CNY, ¥) and an "### Overseas
// Pricing" section (USD, $). Only the Domestic "Language Models" table is
// used. That table has columns
//   Inference Type | Model Name | Input (Cache Hit) | Input (Cache Miss) | Output
// where the Inference Type cell is rowspan'd across a group of models. Only
// the "Real-time API" group is kept (Batch API is skipped).
import { parsePrice, splitCells, splitRows, splitTables } from "../lib.mjs";

export async function parse(content) {
  // Fail closed: if either heading is missing (page reworded), parsing the
  // full page would let the Overseas (USD) rows overwrite the Domestic (CNY)
  // rows, silently storing USD values as CNY.
  const domesticIdx = content.indexOf("### Domestic Pricing");
  const overseasIdx = content.indexOf("### Overseas Pricing");
  if (domesticIdx < 0 || overseasIdx <= domesticIdx) {
    throw new Error("mimo: Domestic/Overseas Pricing sections not found");
  }
  const region = content.slice(domesticIdx, overseasIdx);

  const models = {};
  let currentType = null;
  for (const table of splitTables(region)) {
    const rows = splitRows(table).map(splitCells);
    if (rows.length < 2) continue;
    const header = rows[0].map((c) => c.text);
    if (!header.some((h) => /Model Name/i.test(h))) continue;

    for (const cells of rows.slice(1)) {
      const modelIndex = cells.findIndex((c) => /`mimo-/.test(c.text));
      if (modelIndex < 0) continue;
      if (modelIndex >= 1) currentType = cells[modelIndex - 1].text;
      if (!/real-time/i.test(currentType ?? "")) continue;
      const id = cells[modelIndex].text.replace(/`/g, "").trim();
      const cached = parsePrice(cells[modelIndex + 1]?.text);
      const input = parsePrice(cells[modelIndex + 2]?.text);
      const output = parsePrice(cells[modelIndex + 3]?.text);
      if (!id || input == null || output == null) continue;
      models[id] = {
        currency: "CNY",
        inputPerMillion: input,
        cachedInputPerMillion: cached,
        outputPerMillion: output,
      };
    }
  }
  return models;
}
