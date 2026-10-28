// Parser for https://platform.minimaxi.com/document/pricing (server-rendered
// HTML, redirects to platform.minimax.cn).
//
// Token-priced models live in HTML tables whose header row contains both
// "输入价格" and "输出价格". Two column layouts appear:
//   模型 | 输入价格 | 输出价格 | 缓存读取   (4 cols, input/output/cached)
//   模型/接口 | 输入价格 | 输出价格       (3 cols, no cache column)
// MiniMax-M3 is tiered by input length (≤ 512k / > 512k); the tier qualifier
// follows the model name in the same cell. The page renders the model twice —
// once under the "标准" (standard) tab and once under "优先" (priority, 1.5x)
// — so the first occurrence wins and the priority duplicate is dropped.
// Strikethrough original prices ("<del>4.20</del> 2.10") resolve to the
// current (non-strikethrough) price.
import { parsePrice, splitCells, splitRows, splitTables } from "../lib.mjs";

// "<del>4.20</del> 2.10" -> "2.10" (drop the struck-through original price).
function currentPrice(html) {
  return html.replace(/<del>.*?<\/del>/gi, " ");
}

export async function parse(content) {
  const models = {};
  const tierGroups = {}; // model id -> [{ condition, input, cached, output }]
  const seen = new Set(); // model ids already captured (first occurrence wins)

  for (const table of splitTables(content)) {
    const rows = splitRows(table).map(splitCells);
    if (rows.length < 2) continue;
    const header = rows[0].map((c) => c.text).join(" ");
    if (!/输入价格/.test(header) || !/输出价格/.test(header)) continue;

    const hasCache = rows[0].length >= 4;
    const tableEntries = [];
    for (const row of rows.slice(1)) {
      if (row.length < 3) continue;
      const modelCell = row[0].text;
      const idMatch = /^(MiniMax-[\w.\-]+)/.exec(modelCell);
      if (!idMatch) continue;
      const id = idMatch[1];
      if (seen.has(id)) continue; // priority-tab duplicate of an earlier model

      const input = parsePrice(currentPrice(row[1].html));
      const output = parsePrice(currentPrice(row[2].html));
      if (input == null || output == null) continue;
      const cached = hasCache ? parsePrice(currentPrice(row[3].html)) : undefined;

      const condition = modelCell
        .slice(id.length)
        .replace(/永久五折/g, "")
        .replace(/\*\s*$/, "")
        .trim();
      tableEntries.push({ id, input, output, cached, condition });
    }

    // Mark ids seen only after the whole table, so a tiered model's multiple
    // rows (same id) in one table are all captured; the priority-tab duplicate
    // table is skipped because its ids are already seen.
    for (const e of tableEntries) seen.add(e.id);

    for (const e of tableEntries) {
      if (e.condition) {
        (tierGroups[e.id] ??= []).push({
          condition: e.condition,
          input: e.input,
          cached: e.cached,
          output: e.output,
        });
      } else {
        models[e.id] = {
          currency: "CNY",
          inputPerMillion: e.input,
          ...(e.cached != null ? { cachedInputPerMillion: e.cached } : {}),
          outputPerMillion: e.output,
        };
      }
    }
  }

  for (const [id, tiers] of Object.entries(tierGroups)) {
    const base = tiers[0];
    const pricing = {
      currency: "CNY",
      inputPerMillion: base.input,
      cachedInputPerMillion: base.cached,
      outputPerMillion: base.output,
    };
    models[id] = {
      ...pricing,
      pricing,
      tiers: tiers.map((t, i) => ({
        condition: t.condition,
        inputPerMillion: t.input,
        cachedInputPerMillion: t.cached,
        outputPerMillion: t.output,
        ...(i === 0 ? { isBase: true } : {}),
      })),
    };
  }

  if (Object.keys(models).length === 0) {
    throw new Error("minimax: no models parsed");
  }
  return models;
}
