// Parser for https://help.aliyun.com/zh/model-studio/model-pricing
// (Alibaba Model Studio / Qwen, CNY).
//
// The page is a large server-rendered HTML document whose full content is
// duplicated in two halves (a rendering artifact); processing every section
// with first-wins is idempotent. Scope: only the <h2> sections 文本生成-千问
// and 文本生成-千问-开源版 (third-party hosted models and the image/video/
// audio/TTS sections are out of scope). Within each <h3> series only the
// first 华北2（北京） <h4> region is used.
//
// Table layout (the HTML carries no colspan/rowspan attributes):
// - single-row header: 模型 ID | [模式] | [单次请求的输入Token数/范围] |
//   输入单价（每百万Token） | [缓存命中输入单价] | 输出单价（每百万Token） |
//   [免费额度]; tier continuation rows repeat only [条件 | 输入 | 输出…]
//   without the 模型 ID cell.
// - two-row header: the second row (shorter, no prices) splits 输出单价 into
//   非思考模式 / 思考模式 sub-columns; the first sub-column (非思考模式) is
//   the price.
// A table is accepted only when it has a 模型 ID column and 每百万Token
// input+output columns. Tables whose rows do not fit the header (e.g. omni
// modality sub-pricing 文本/音频/图片) are skipped. When a 服务部署范围
// column exists, only 中国内地 rows are kept.
//
// Tiered pricing: the 输入Token数/范围 column holds the tier condition
// (0<Token≤256K, normalized to "0 < Token ≤ 256K"; 无阶梯计价 = flat).
// Rows are grouped by model id (first token of the 模型 ID cell); 2+ rows ->
// TieredPricing, 1 row -> flat. Discount cells like "原价2元（限时8折）"
// resolve to 2*0.8=1.6 with a note.
import { parsePrice, splitTables, splitRows, splitCells } from "../lib.mjs";

const CURRENCY = "CNY";

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, "");
}

// Slice the page down to the in-scope h2 sections (both duplicated halves).
function scopeHtml(html) {
  const h2Re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/g;
  const h2s = [];
  let m;
  while ((m = h2Re.exec(html)) !== null) {
    h2s.push({ index: m.index, end: m.index + m[0].length, title: stripTags(m[1]).trim() });
  }
  const parts = [];
  for (let i = 0; i < h2s.length; i++) {
    if (!/文本生成-千问/.test(h2s[i].title)) continue;
    const end = i + 1 < h2s.length ? h2s[i + 1].index : html.length;
    parts.push(html.slice(h2s[i].end, end));
  }
  return parts.join("\n");
}

// Split the scoped html into <h3> sections (from one h3 to the next).
function splitSections(html) {
  const h3Re = /<h3\b[^>]*>[\s\S]*?<\/h3>/g;
  const positions = [];
  let m;
  while ((m = h3Re.exec(html)) !== null) {
    positions.push({ start: m.index, end: m.index + m[0].length });
  }
  const sections = [];
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1].start : html.length;
    sections.push(html.slice(positions[i].end, end));
  }
  return sections;
}

// Keep only the first 华北2（北京） region of a section (content between that
// h4 and the next h4). Sections without h4s are returned as-is.
function beijingRegion(sectionHtml) {
  const h4Re = /<h4\b[^>]*>([\s\S]*?)<\/h4>/g;
  const h4s = [];
  let m;
  while ((m = h4Re.exec(sectionHtml)) !== null) {
    h4s.push({ index: m.index, end: m.index + m[0].length, title: stripTags(m[1]).trim() });
  }
  if (h4s.length === 0) return sectionHtml;
  for (let i = 0; i < h4s.length; i++) {
    if (h4s[i].title.includes("华北2")) {
      const end = i + 1 < h4s.length ? h4s[i + 1].index : sectionHtml.length;
      return sectionHtml.slice(h4s[i].end, end);
    }
  }
  return "";
}

function hasPrice(text) {
  return /[\d.]+\s*元/.test(text) || /^\d/.test(text);
}

// "tongyi-xiaomi-analysis-flash上下文缓存享有折扣" / "qwen3.7-plus\n..." -> id.
function modelIdFromCell(text) {
  if (!text) return null;
  const m = /^([A-Za-z0-9][A-Za-z0-9.\-]*)/.exec(text.trim());
  return m ? m[1] : null;
}

// "0<Token≤256K" -> "0 < Token ≤ 256K".
function normalizeCondition(text) {
  return text
    .replace(/\s+/g, "")
    .replace(/</g, " < ")
    .replace(/≤/g, " ≤ ")
    .replace(/\s+/g, " ")
    .trim();
}

function isConditionCell(text) {
  return (
    text === "无阶梯计价" || (/token/i.test(text) && /<|≤/.test(text))
  );
}

// "原价2元（限时8折）" -> { value: 1.6, orig: 2, disc: 8 }; anything else
// falls back to parsePrice.
function parsePriceCell(text) {
  if (text == null) return { value: null, orig: null, disc: null };
  const m = /原价\s*([\d.]+)\s*元\s*[（(]限时\s*([\d.]+)\s*折[)）]/.exec(text);
  if (m) {
    const orig = Number(m[1]);
    const disc = Number(m[2]);
    return { value: Math.round(((orig * disc) / 10) * 10000) / 10000, orig, disc };
  }
  return { value: parsePrice(text), orig: null, disc: null };
}

// Map a table to a flat column list + output column indices, or null when
// the header is not a token-priced 模型 ID / 输入单价 / 输出单价 layout.
function mapColumns(headerRows) {
  const row0 = headerRows[0].map((c) => c.text);
  const row1 = headerRows.length > 1 ? headerRows[1].map((c) => c.text) : null;

  // Two-row header: row1 is shorter, price-free, and row0 has an 输出单价
  // column that row1 splits into sub-columns (非思考模式 / 思考模式).
  if (row1 && row1.length < row0.length && row1.every((c) => !hasPrice(c))) {
    const outIdx = row0.findIndex((c) => /输出单价/.test(c));
    if (outIdx < 0 || !/每\s*百万\s*token/i.test(row0[outIdx])) return null;
    const cols = row0.slice();
    cols.splice(outIdx, 1, ...row1);
    const outputCols = row1.map((_, k) => outIdx + k);
    return { cols, outputCols };
  }
  if (row1) return null; // unexpected extra header row
  const idx = row0.findIndex(
    (c) => /输出单价/.test(c) && /每\s*百万\s*token/i.test(c)
  );
  return idx >= 0 ? { cols: row0, outputCols: [idx] } : null;
}

function findCol(cols, predicate) {
  return cols.findIndex((c) => predicate(c));
}

// Parse one table into a Map modelId -> tier rows; null when not usable.
function parseTable(table) {
  const rows = splitRows(table).map(splitCells);
  if (rows.length < 2) return null;

  // Detect a two-row header (row1 shorter than row0 and price-free).
  const row1 = rows[1];
  const isTwoRowHeader =
    rows.length >= 3 &&
    row1.length < rows[0].length &&
    row1.every((c) => !hasPrice(c.text));
  const headerRows = isTwoRowHeader ? rows.slice(0, 2) : rows.slice(0, 1);
  const header = mapColumns(headerRows);
  if (!header) return null;
  const cols = header.cols;
  const outputCol = header.outputCols[0]; // 非思考模式 / single 输出单价

  const modelCol = findCol(cols, (c) => /模型\s*id/i.test(c));
  const inputCol = findCol(
    cols,
    (c) =>
      /输入单价/.test(c) && !/缓存/.test(c) && /每\s*百万\s*token/i.test(c)
  );
  if (modelCol < 0 || inputCol < 0) return null;

  const cachedCol = findCol(cols, (c) => /缓存命中输入单价/.test(c));
  const condCol = findCol(cols, (c) => /输入\s*token/i.test(c));
  const scopeCol = findCol(cols, (c) => /服务部署范围/.test(c));

  // Tier continuation rows carry exactly these columns, in this order.
  const tierCols = [condCol, inputCol, cachedCol, ...header.outputCols]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);

  const entries = new Map();
  let lastModel = null;
  for (const cells of rows.slice(headerRows.length)) {
    const texts = cells.map((c) => c.text);
    let model;
    let values; // { cond, input, cached, output }
    if (texts.length === cols.length) {
      model = modelIdFromCell(texts[modelCol]);
      if (!model) continue;
      if (scopeCol >= 0 && texts[scopeCol] !== "中国内地") continue;
      values = {
        cond: condCol >= 0 ? texts[condCol] : null,
        input: texts[inputCol],
        cached: cachedCol >= 0 ? texts[cachedCol] : null,
        output: texts[outputCol],
      };
    } else if (
      texts.length === tierCols.length &&
      lastModel &&
      isConditionCell(texts[0])
    ) {
      model = lastModel;
      values = { cond: null, input: null, cached: null, output: null };
      tierCols.forEach((col, k) => {
        if (col === condCol) values.cond = texts[k];
        else if (col === inputCol) values.input = texts[k];
        else if (col === cachedCol) values.cached = texts[k];
        else if (col === outputCol) values.output = texts[k];
      });
    } else {
      continue; // row does not fit the header (e.g. modality sub-pricing)
    }

    const input = parsePriceCell(values.input);
    const output = parsePriceCell(values.output);
    if (input.value == null || output.value == null) continue;
    lastModel = model;

    let note;
    if (input.orig != null && output.orig != null) {
      note = `原价 ${input.orig}/${output.orig} 元，限时 ${input.disc} 折`;
    } else if (input.orig != null) {
      note = `输入原价 ${input.orig} 元，限时 ${input.disc} 折`;
    } else if (output.orig != null) {
      note = `输出原价 ${output.orig} 元，限时 ${output.disc} 折`;
    }

    const condText = (values.cond ?? "").trim();
    const condition =
      condText && condText !== "无阶梯计价" ? normalizeCondition(condText) : null;

    const row = {
      condition,
      note,
      input: input.value,
      cached: parsePrice(values.cached),
      output: output.value,
    };
    const list = entries.get(model);
    if (list) list.push(row);
    else entries.set(model, [row]);
  }
  return entries;
}

export async function parse(content) {
  const scoped = scopeHtml(content);
  const groups = new Map(); // model id -> tier rows (first-wins across halves)

  for (const section of splitSections(scoped)) {
    const region = beijingRegion(section);
    for (const table of splitTables(region)) {
      const entries = parseTable(table);
      if (!entries) continue;
      for (const [id, rows] of entries) {
        if (groups.has(id)) continue; // duplicated half / earlier table wins
        groups.set(id, rows);
      }
    }
  }

  const models = {};
  for (const [id, rows] of groups) {
    if (rows.length >= 2) {
      const base = rows[0];
      const pricing = {
        currency: CURRENCY,
        inputPerMillion: base.input,
        cachedInputPerMillion: base.cached,
        outputPerMillion: base.output,
      };
      models[id] = {
        ...pricing,
        pricing,
        tiers: rows.map((t, i) => ({
          condition: t.condition ?? `第${i + 1}档`,
          ...(t.note ? { note: t.note } : {}),
          inputPerMillion: t.input,
          cachedInputPerMillion: t.cached,
          outputPerMillion: t.output,
          ...(i === 0 ? { isBase: true } : {}),
        })),
      };
    } else {
      const b = rows[0];
      models[id] = {
        currency: CURRENCY,
        inputPerMillion: b.input,
        cachedInputPerMillion: b.cached,
        outputPerMillion: b.output,
      };
    }
  }
  return models;
}
