// Parser for https://api-docs.deepseek.com/quick_start/pricing.
//
// The page is a single table. The "MODEL" row's last two cells are the model
// ids (may carry a "(1)" footnote marker that must be stripped). The PRICING
// block has three metrics, each with an OFF-PEAK row followed by a PEAK
// continuation row:
//   - "1M INPUT TOKENS(CACHE HIT)"  -> cachedInputPerMillion
//   - "1M INPUT TOKENS(CACHE MISS)" -> inputPerMillion
//   - "1M OUTPUT TOKENS"            -> outputPerMillion
// The page prints "$" but DeepSeek bills in CNY at the same numbers, so the
// output currency is CNY (matching the existing catalog).
import { parsePrice, splitCells, splitRows, splitTables } from "../lib.mjs";

const METRIC_FIELD = {
  "1M INPUT TOKENS(CACHE HIT)": "cachedInputPerMillion",
  "1M INPUT TOKENS(CACHE MISS)": "inputPerMillion",
  "1M OUTPUT TOKENS": "outputPerMillion",
};

export async function parse(content) {
  const tables = splitTables(content);
  if (tables.length === 0) return {};

  const rows = splitRows(tables[0]).map(splitCells);
  const modelIds = [];
  const models = {};
  let currentMetric = null;

  for (const cells of rows) {
    if (cells.length === 0) continue;
    const label = cells[0].text.toUpperCase();

    if (label === "MODEL") {
      for (const cell of cells.slice(-2)) {
        const id = cell.text.replace(/\s*\(\d+\)\s*$/, "").trim();
        if (id) modelIds.push(id);
      }
      continue;
    }

    const periodIndex = cells.findIndex((c) => /off-peak|peak/i.test(c.text));
    if (periodIndex < 0) continue;
    const isOffPeak = /off-peak/i.test(cells[periodIndex].text);
    const values = cells.slice(periodIndex + 1);
    if (isOffPeak) {
      // The metric label sits in the cell just before the period.
      currentMetric = METRIC_FIELD[cells[periodIndex - 1]?.text.toUpperCase()];
    }
    if (!currentMetric) continue;
    assignValues(modelIds, models, currentMetric, isOffPeak ? "offPeak" : "peak", values);
  }

  return models;
}

function assignValues(modelIds, models, field, period, valueCells) {
  modelIds.forEach((id, index) => {
    const value = parsePrice(valueCells[index]?.text);
    if (value == null) return;
    if (!models[id]) models[id] = { peak: {}, offPeak: {} };
    models[id][period] = {
      currency: "CNY",
      inputPerMillion: null,
      cachedInputPerMillion: null,
      outputPerMillion: null,
      ...models[id][period],
    };
    models[id][period][field] = value;
  });
}
