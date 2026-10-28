// Parser for https://openai.com/api/pricing/.
//
// The pricing tables are rendered client-side by Astro islands: each
// <astro-island> tag carries the table data in its `props` attribute as
// v-decoded JSON (raw values as [0, value], arrays as [1, [...]]). The
// standard-tier table is the island whose decoded props contain
// `tier: "standard"` and a `rows` array; we keep the largest such island
// (a smaller "cyber" table shares the same tier). Row shape:
// [model, input, cachedInput?, (write30m?), output] — the last cell is
// output, the second is input, and the third is cached input when numeric.
import { decodeEntities } from "../lib.mjs";

// Recursively decode Astro's v-decode encoding.
function vDecode(value) {
  if (Array.isArray(value)) {
    if (value.length === 2 && value[0] === 0) return value[1];
    if (value.length === 2 && value[0] === 1) return value[1].map(vDecode);
    return value.map(vDecode);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = vDecode(v);
    return out;
  }
  return value;
}

// "gpt-5.5 (<272K context length)" -> "gpt-5.5";
// "gpt-5.5-pro (high)" -> "gpt-5.5-pro"
function cleanModelName(name) {
  return name
    .replace(/\s*\(<[^)]*context length[^)]*\)/g, "")
    .replace(/\s*\((?:high|medium|low)\)$/g, "")
    .trim();
}

function cellText(cell) {
  if (typeof cell === "string") return cell.trim();
  if (Array.isArray(cell)) return cell.map(cellText).join(" ").trim();
  return "";
}

export async function parse(content) {
  const islandRe = /<astro-island\b[^>]*\bprops="([^"]*)"[^>]*>/g;
  let best = null; // { rows }
  let match;
  while ((match = islandRe.exec(content)) !== null) {
    let decoded;
    try {
      decoded = vDecode(JSON.parse(decodeEntities(match[1])));
    } catch {
      continue;
    }
    if (decoded?.tier !== "standard") continue;
    const rows = decoded?.rows;
    if (!Array.isArray(rows) || rows.length === 0) continue;
    if (!best || rows.length > best.rows.length) best = { rows };
  }
  if (!best) throw new Error("openai: no standard-tier pricing island found");

  const models = {};
  for (const row of best.rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const name = cleanModelName(cellText(row[0]));
    const input = Number(row[1]);
    const output = Number(row[row.length - 1]);
    if (!name || !Number.isFinite(input) || !Number.isFinite(output)) continue;
    if (models[name]) continue; // first occurrence wins for (high)/(low) variants
    const cached = row.length > 3 && row[2] != null ? Number(row[2]) : NaN;
    models[name] = {
      currency: "USD",
      inputPerMillion: input,
      ...(Number.isFinite(cached) ? { cachedInputPerMillion: cached } : {}),
      outputPerMillion: output,
    };
  }
  if (Object.keys(models).length === 0) throw new Error("openai: no models parsed");
  return models;
}
