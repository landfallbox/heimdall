// Parser for https://www.sensecore.cn/help/docs/model-as-a-service/nova/pricing
// (public, server-rendered Docusaurus page; the console.sensecore.cn copy is
// login-gated and must NOT be used).
//
// Token-priced models live in HTML tables. Two row layouts appear:
//   5 cols: 服务 | 输入tokens | 0.003元/千tokens | 输出tokens | 0.009元/千tokens
//   3 cols: 服务 | 输入tokens、输出tokens | 0.015元/千tokens   (single price)
// A single price covers both directions only when the input label mentions
// both (e.g. "输入tokens、输出tokens"); such a row may be 3-col, or 5-col with
// an empty trailing output cell. Separate-label rows with a blank output cell
// are skipped rather than back-filled with the input price.
// Duplicate model rows keep the first valid row (first occurrence wins).
// The hyphen slug (sensenova-v6-5-pro) is derived from the dotted canonical
// entry so the alias never drifts from the model it aliases.
// Prices are quoted in CNY per THOUSAND tokens (元/千tokens); the catalog stores
// CNY per million tokens, so values are multiplied by 1000.
//
// Only rows whose price cell contains "元/千tokens" are processed, which
// naturally excludes per-minute (SenseNova-V6-Omni), per-character
// (SenseNova-Audio-Fusion-0603), and free (nova-tts-1) rows.
//
// SenseNova 6.8 Flash Lite is a free Preview model not listed on this page; it
// is a hand-written catalog entry (see data/pricing.json) and excluded from the
// round-trip test via KNOWN_RETIRED.
import { parsePrice, splitCells, splitRows, splitTables } from "../lib.mjs";

const TOKEN_PRICE = /元\/千tokens/;
const MODEL_NAME = /^(SenseNova|SenseChat)[\w.\-]+/;
const PER_MILLION = 1000;

export async function parse(content) {
  const models = {};

  for (const table of splitTables(content)) {
    const rows = splitRows(table).map(splitCells);
    for (const row of rows) {
      const modelCell = row[0]?.text;
      if (!modelCell) continue;
      const idMatch = MODEL_NAME.exec(modelCell);
      if (!idMatch) continue;
      if (!row[2]) continue; // short colspan rows have no price cell
      const id = idMatch[0].toLowerCase();

      let input;
      let output;
      const hasOutputCell = row.length >= 5;
      if (hasOutputCell && TOKEN_PRICE.test(row[4].text) && TOKEN_PRICE.test(row[2].text)) {
        input = parsePrice(row[2].text);
        output = parsePrice(row[4].text);
      } else if (
        (!hasOutputCell || row[4].text === "") &&
        TOKEN_PRICE.test(row[2].text) &&
        /输入/.test(row[1].text) &&
        /输出/.test(row[1].text)
      ) {
        // Single price for both input and output: the billing-item label must
        // cover both directions (e.g. "输入tokens、输出tokens"). 5-col rows
        // with separate labels and a blank output cell are skipped rather
        // than back-filled with the input price.
        input = parsePrice(row[2].text);
        output = input;
      } else {
        continue; // per-minute / per-character / free rows are not token-priced
      }
      if (input == null || output == null) continue;
      if (models[id]) continue; // first occurrence wins

      models[id] = {
        currency: "CNY",
        inputPerMillion: input * PER_MILLION,
        cachedInputPerMillion: null,
        outputPerMillion: output * PER_MILLION,
      };
    }
  }

  // The catalog keeps a hyphen alias for the canonical dotted V6.5-Pro id.
  // Derive it from the parsed entry so a price change keeps both in sync.
  const canonical = models["sensenova-v6.5-pro"];
  if (canonical) models["sensenova-v6-5-pro"] = { ...canonical };

  if (Object.keys(models).length === 0) {
    throw new Error("sensenova: no models parsed");
  }
  return models;
}
