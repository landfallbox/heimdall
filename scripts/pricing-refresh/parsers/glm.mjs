// Parser for https://docs.bigmodel.cn/cn/guide/start/pricing.md (Zhipu GLM).
//
// The .md endpoint returns pipe tables. LLM pricing tables have a header
// containing 输入单价 / 输出单价 / 缓存命中 (6 or 7 columns; the 7th "输入模态"
// is ignored). Column order: 模型名称 | 上下文 | 输入单价 | 输出单价 | 缓存存储 | 缓存命中.
// Models are tiered by input length (multiple rows per model); the catalog
// stores the first (base) row as a flat entry. "免费" rows are skipped,
// "不支持" cache resolves to null, and model names are lowercased. The page
// lists more models than the catalog tracks (legacy and vision models); the
// extras surface as additions in the refresh report for human review.
import { parsePrice, splitMarkdownTables } from "../lib.mjs";

export async function parse(content) {
  const models = {};
  for (const table of splitMarkdownTables(content)) {
    if (table.length < 2) continue;
    const header = table[0].join(" ");
    if (!/输入单价/.test(header) || !/输出单价/.test(header) || !/缓存命中/.test(header)) {
      continue;
    }
    for (const row of table.slice(1)) {
      const rawName = (row[0] ?? "").trim();
      if (!rawName) continue;
      const input = parsePrice(row[2]);
      const output = parsePrice(row[3]);
      const cached = parsePrice(row[5]);
      if (input == null || output == null) continue; // free / non-token models
      const name = rawName.toLowerCase();
      if (models[name]) continue; // first (base) row wins
      models[name] = {
        currency: "CNY",
        inputPerMillion: input,
        cachedInputPerMillion: cached,
        outputPerMillion: output,
      };
    }
  }
  return models;
}
