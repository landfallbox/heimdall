// Parser for https://platform.stepfun.com/docs/zh/guides/pricing/details.md
//
// The page is markdown with several pipe-tables. Only the "文本与多模态模型"
// table is token-priced (4 columns: Model ID / 输入价格（缓存未命中） /
// 输入价格（缓存命中） / 输出价格). The voice and value-added tables bill per
// call / character / hour and are skipped.
import { parsePrice, splitMarkdownTables } from "../lib.mjs";

export async function parse(content) {
  const models = {};
  for (const table of splitMarkdownTables(content)) {
    if (table.length < 2) continue;
    const header = table[0];
    // The token-priced text table has a 4-column header with cache-miss,
    // cache-hit and output price columns.
    if (
      header.length === 4 &&
      /缓存未命中/.test(header[1] ?? "") &&
      /缓存命中/.test(header[2] ?? "") &&
      /输出价格/.test(header[3] ?? "")
    ) {
      for (const row of table.slice(1)) {
        const id = (row[0] ?? "").replace(/`/g, "").trim();
        if (!id) continue;
        const input = parsePrice(row[1]);
        const cached = parsePrice(row[2]);
        const output = parsePrice(row[3]);
        if (input == null || output == null) continue;
        models[id] = {
          currency: "CNY",
          inputPerMillion: input,
          cachedInputPerMillion: cached,
          outputPerMillion: output,
        };
      }
    }
  }
  return models;
}
