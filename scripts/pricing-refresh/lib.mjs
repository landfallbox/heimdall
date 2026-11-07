// Shared helpers for the pricing refresh scripts: fetching, HTML/markdown
// table splitting, and the merge logic for data/pricing.json.
//
// The merge only adds or modifies models: retired models are never deleted and
// a vendor whose scrape lost most of its models is skipped entirely (circuit
// breaker) so a page redesign never commits half-written data.
import { validateRemotePricing } from "../../src/pricing-updater.ts";
import { isValidModelId, NOISE_WORDS } from "../../src/model-info-schema.ts";

export { isValidModelId, NOISE_WORDS };

export const ZERO_PRICE_WHITELIST = new Set([
  "sensenova/sensenova-6.8-flash-lite",
  "sensenova-6.8-flash-lite",
]);

export const HIGH_PRICE_WHITELIST = new Set([
  "openai/o1-pro",
  "o1-pro",
  "qwen/qwen-deep-research-2025-12-15",
  "qwen-deep-research-2025-12-15",
]);

export const PRICE_BOUNDS = {
  USD: { min: 0.001, max: 200, highMax: 1000 },
  CNY: { min: 0.001, max: 1500, highMax: 7000 },
};

/**
 * Validates whether a token price is within reasonable common-sense bounds.
 * @param {number} price
 * @param {{ currency?: string, modelId?: string, vendor?: string }} [options]
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePriceSanity(price, { currency = "USD", modelId = "", vendor = "" } = {}) {
  if (price === null || price === undefined) return { valid: true };
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    return { valid: false, reason: `price must be a non-negative finite number, got ${price}` };
  }

  const fullId = vendor ? `${vendor}/${modelId}` : modelId;
  const isZeroWhitelisted = ZERO_PRICE_WHITELIST.has(modelId) || ZERO_PRICE_WHITELIST.has(fullId);

  if (price === 0) {
    if (isZeroWhitelisted) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `price cannot be 0 for non-whitelisted model ${fullId || "unknown"}`,
    };
  }

  const bounds = PRICE_BOUNDS[currency] ?? PRICE_BOUNDS.USD;
  const isHighWhitelisted = HIGH_PRICE_WHITELIST.has(modelId) || HIGH_PRICE_WHITELIST.has(fullId);
  const max = isHighWhitelisted ? bounds.highMax : bounds.max;

  if (price < bounds.min) {
    return {
      valid: false,
      reason: `price ${price} ${currency} is below minimum sanity bound ${bounds.min}`,
    };
  }
  if (price > max) {
    return {
      valid: false,
      reason: `price ${price} ${currency} exceeds maximum sanity bound ${max}`,
    };
  }
  return { valid: true };
}

/**
 * Extracts numeric prices and their dot-notation paths from an entry.
 * @param {any} entry
 * @returns {Array<{ path: string, value: number }>}
 */
export function extractPrices(entry) {
  const prices = [];
  if (!entry) return prices;

  const pushIfNumber = (val, path) => {
    if (typeof val === "number") prices.push({ path, value: val });
  };

  if (entry.peak && entry.offPeak) {
    pushIfNumber(entry.peak.inputPerMillion, "peak.inputPerMillion");
    pushIfNumber(entry.peak.cachedInputPerMillion, "peak.cachedInputPerMillion");
    pushIfNumber(entry.peak.outputPerMillion, "peak.outputPerMillion");
    pushIfNumber(entry.offPeak.inputPerMillion, "offPeak.inputPerMillion");
    pushIfNumber(entry.offPeak.cachedInputPerMillion, "offPeak.cachedInputPerMillion");
    pushIfNumber(entry.offPeak.outputPerMillion, "offPeak.outputPerMillion");
  } else if (Array.isArray(entry.tiers)) {
    const base = entry.pricing ?? entry;
    pushIfNumber(base.inputPerMillion, "pricing.inputPerMillion");
    pushIfNumber(base.cachedInputPerMillion, "pricing.cachedInputPerMillion");
    pushIfNumber(base.outputPerMillion, "pricing.outputPerMillion");
    entry.tiers.forEach((t, i) => {
      pushIfNumber(t.inputPerMillion, `tier[${i}].inputPerMillion`);
      pushIfNumber(t.cachedInputPerMillion, `tier[${i}].cachedInputPerMillion`);
      pushIfNumber(t.outputPerMillion, `tier[${i}].outputPerMillion`);
    });
  } else {
    pushIfNumber(entry.inputPerMillion, "inputPerMillion");
    pushIfNumber(entry.cachedInputPerMillion, "cachedInputPerMillion");
    pushIfNumber(entry.outputPerMillion, "outputPerMillion");
  }
  return prices;
}

/**
 * Checks price differences between current and incoming entries for sudden mutations (>50%).
 * @param {any} current
 * @param {any} incoming
 * @param {{ vendor?: string, id?: string }} [options]
 * @returns {Array<{ vendor: string, id: string, path: string, prevVal: any, nextVal: any, ratio: number }>}
 */
export function checkPriceDeltas(current, incoming, { vendor = "", id = "" } = {}) {
  const anomalies = [];
  if (!current || !incoming) return anomalies;

  const currentPrices = new Map(extractPrices(current).map((p) => [p.path, p.value]));
  const incomingPrices = extractPrices(incoming);

  for (const { path, value: nextVal } of incomingPrices) {
    if (currentPrices.has(path)) {
      const prevVal = currentPrices.get(path);
      if (prevVal !== nextVal) {
        const ratio = prevVal > 0 ? Math.abs(nextVal - prevVal) / prevVal : 1.0;
        if (ratio > 0.5) {
          anomalies.push({ vendor, id, path, prevVal, nextVal, ratio });
        }
      }
    }
  }

  if (current.currency && incoming.currency && current.currency !== incoming.currency) {
    anomalies.push({
      vendor,
      id,
      path: "currency",
      prevVal: current.currency,
      nextVal: incoming.currency,
      ratio: 1.0,
    });
  }

  return anomalies;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// A small cross-call cookie jar. Some docs sites (ai.google.dev) bounce
// unauthenticated clients through an OAuth redirect loop; following the
// redirects with cookies makes the loop settle on the real page instead of
// exceeding the redirect limit.
const cookieJar = new Map(); // domain -> Map(name -> value)

function storeSetCookies(setCookies, responseUrl) {
  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const domainAttr = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a));
    const domain = domainAttr
      ? domainAttr.slice("domain=".length).replace(/^\./, "").toLowerCase()
      : new URL(responseUrl).hostname;
    if (!cookieJar.has(domain)) cookieJar.set(domain, new Map());
    cookieJar.get(domain).set(name, value);
  }
}

function cookieHeaderFor(url) {
  const host = new URL(url).hostname;
  const parts = [];
  for (const [domain, cookies] of cookieJar) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      for (const [name, value] of cookies) parts.push(`${name}=${value}`);
    }
  }
  return parts.join("; ");
}

// Fetch a URL with a browser-like User-Agent, following redirects manually so
// cookies are kept. Network-level errors are retried (docs sites are flaky
// from CI); HTTP errors are not.
export async function fetchText(url, { timeoutMs = 30000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    try {
      return await fetchTextOnce(url, timeoutMs);
    } catch (error) {
      lastError = error;
      // HTTP errors (4xx/5xx) are deterministic; do not retry them.
      if (/HTTP \d{3}/.test(error.message)) throw error;
    }
  }
  throw lastError;
}

async function fetchTextOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop < 10; hop++) {
      const headers = {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
        // Force English: docs sites localize by geolocation (ai.google.dev
        // served Persian to this machine, which breaks label matching).
        "Accept-Language": "en-US,en;q=0.9",
      };
      const cookie = cookieHeaderFor(current);
      if (cookie) headers.Cookie = cookie;
      const response = await fetch(current, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
      storeSetCookies(response.headers.getSetCookie(), current);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          throw new Error(`GET ${current} -> HTTP ${response.status} without Location`);
        }
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) {
        throw new Error(`GET ${current} -> HTTP ${response.status}`);
      }
      return await response.text();
    }
    throw new Error(`GET ${url} -> too many redirects`);
  } finally {
    clearTimeout(timer);
  }
}

// Strip HTML tags and decode the entities used by the scraped pages.
export function stripHtml(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ""));
}

export function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Split HTML into table strings.
export function splitTables(html) {
  const tables = [];
  let cursor = 0;
  while (true) {
    const start = html.indexOf("<table", cursor);
    if (start === -1) break;
    const end = html.indexOf("</table>", start);
    if (end === -1) break;
    tables.push(html.slice(start, end + "</table>".length));
    cursor = end + "</table>".length;
  }
  return tables;
}

// Split a table string into its rows (each a "<tr>...</tr>" string).
export function splitRows(table) {
  const rows = [];
  let cursor = 0;
  while (true) {
    const start = table.indexOf("<tr", cursor);
    if (start === -1) break;
    const end = table.indexOf("</tr>", start);
    if (end === -1) break;
    rows.push(table.slice(start, end + "</tr>".length));
    cursor = end + "</tr>".length;
  }
  return rows;
}

// Split a row into cells. Each cell is { html, text, colspan, rowspan } where
// text is the tag-stripped, entity-decoded, trimmed content.
export function splitCells(row) {
  const cells = [];
  const cellRe = /<t[dh]\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>)/g;
  let match;
  while ((match = cellRe.exec(row)) !== null) {
    const attrs = match[1] ?? "";
    const html = match[2] ?? "";
    const colspanMatch = /\bcolspan\s*=\s*["']?(\d+)/i.exec(attrs);
    const rowspanMatch = /\browspan\s*=\s*["']?(\d+)/i.exec(attrs);
    cells.push({
      html,
      text: stripHtml(html).trim(),
      colspan: colspanMatch ? Number(colspanMatch[1]) : 1,
      rowspan: rowspanMatch ? Number(rowspanMatch[1]) : 1,
    });
  }
  return cells;
}

// Split a markdown document into pipe-tables. Each returned table is an array
// of rows, where each row is an array of trimmed cell strings. The separator
// row (| - | - |) is dropped.
export function splitMarkdownTables(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const tables = [];
  let current = null;
  for (const line of lines) {
    // Strip a leading blockquote marker so nested "> | ... |" tables parse too.
    const trimmed = line.trim().replace(/^>\s?/, "").trim();
    const isTableRow =
      trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length >= 2;
    if (!isTableRow) {
      if (current && current.length > 0) tables.push(current);
      current = null;
      continue;
    }
    if (!current) current = [];
    const inner = trimmed.slice(1, -1);
    const cells = splitMarkdownRow(inner).map((c) => c.trim());
    // Drop the separator row (cells made only of dashes/colons).
    if (cells.every((c) => /^:?-{1,}:?$/.test(c))) continue;
    current.push(cells);
  }
  if (current && current.length > 0) tables.push(current);
  return tables;
}

// Split a markdown table row body (without the outer pipes) on unescaped pipes.
export function splitMarkdownRow(inner) {
  const cells = [];
  let cell = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\") {
      cell += ch + (inner[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  return cells;
}

// Parse a price cell like "$2.00", "¥3.00", "2.10", "0.003", "免费", "限时免费",
// "不支持", "—" into a number, or null when the value is not a fixed price.
// Strikethrough original prices ("~~4.20~~ 2.10") resolve to the current price.
export function parsePrice(raw) {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (!text) return null;
  // Free / not-supported / placeholder values are not fixed prices.
  if (/免费|not supported|n\/a|—|–|-|TBD/i.test(text)) return null;
  // Strikethrough: keep the non-strikethrough (current) price.
  const strike = text.match(/~~([^~]+)~~\s*([\d.]+)/);
  if (strike) text = strike[2];
  const match = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// Parse a USD price cell ("$15.00 / 1M tokens", "$2.50", "—"). Requires the
// dollar sign so non-price cells (context windows, counts) are never picked
// up. Returns null for free / not-supported / placeholder values.
export function parseUsd(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text || /免费|not supported|n\/a|—|–|TBD/i.test(text)) return null;
  const match = text.replace(/,/g, "").match(/\$\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// Normalize a pricing entry to a stable comparable shape so the merge can tell
// "same price, different wrapper" from a real change.
function normPricing(p) {
  return {
    currency: p?.currency ?? null,
    inputPerMillion: p?.inputPerMillion ?? null,
    cachedInputPerMillion: p?.cachedInputPerMillion ?? null,
    outputPerMillion: p?.outputPerMillion ?? null,
  };
}

function normTier(t) {
  return {
    condition: t?.condition ?? null,
    note: t?.note ?? null,
    inputPerMillion: t?.inputPerMillion ?? null,
    cachedInputPerMillion: t?.cachedInputPerMillion ?? null,
    outputPerMillion: t?.outputPerMillion ?? null,
    isBase: t?.isBase ?? null,
  };
}

function normalizeEntry(e) {
  if (e && e.peak && e.offPeak) {
    return { kind: "rate", peak: normPricing(e.peak), offPeak: normPricing(e.offPeak) };
  }
  if (e && Array.isArray(e.tiers)) {
    return {
      kind: "tiered",
      pricing: normPricing(e.pricing ?? e),
      tiers: e.tiers.map(normTier),
    };
  }
  return { kind: "flat", ...normPricing(e) };
}

export function entriesEqual(a, b) {
  return JSON.stringify(normalizeEntry(a)) === JSON.stringify(normalizeEntry(b));
}

// Merge newly scraped pricing into the existing data. `vendorScrapes` is an
// array of { vendor, models, baselineIds } where models maps model id ->
// pricing entry (Pricing | RateCard | TieredPricing) and baselineIds are the
// model ids the vendor is expected to own (used by the circuit breaker).
//
// Returns { data, added, modified, keptRetired, warnings, acceptedVendors, priceDeltaAnomalies } where
// data is the merged (unvalidated) object, added/modified/keptRetired are
// "vendor/id" strings, and acceptedVendors contains vendors passing the circuit breaker.
export function mergePricing(existing, vendorScrapes) {
  const catalogs = { ...(existing.catalogs ?? {}) };
  const added = [];
  const modified = [];
  const keptRetired = [];
  const warnings = [];
  const acceptedVendors = [];
  const priceDeltaAnomalies = [];

  for (const { vendor, models, baselineIds } of vendorScrapes) {
    const scrapedIds = new Set(Object.keys(models));
    const baseline = new Set(baselineIds ?? []);

    // Circuit breaker: an empty result, or a scrape that lost more than half
    // of the vendor's known models, means the page layout likely changed; skip
    // the vendor entirely so we never commit half-written data.
    if (scrapedIds.size === 0) {
      warnings.push(`${vendor}: no models parsed; skipped vendor entirely`);
      continue;
    }
    if (baseline.size > 0 && scrapedIds.size * 2 < baseline.size) {
      warnings.push(
        `${vendor}: model count dropped from ${baseline.size} to ${scrapedIds.size}; skipped vendor entirely`,
      );
      continue;
    }

    // Flood circuit breaker: single vendor adds > 5 unknown new models
    const newModelsForVendor = Object.keys(models).filter((id) => isValidModelId(id) && !baseline.has(id));
    if (baseline.size > 0 && newModelsForVendor.length > 5) {
      warnings.push(
        `${vendor}: flood risk: abnormally large batch of new models (${newModelsForVendor.length} new models; threshold: 5)`,
      );
    }

    acceptedVendors.push(vendor);

    const catalog = catalogs[vendor] ?? { models: {} };
    const currentModels = { ...(catalog.models ?? {}) };
    let catalogChanged = false;

    const retired = [...baseline].filter((id) => !scrapedIds.has(id));
    if (retired.length > 0) {
      for (const id of retired) keptRetired.push(`${vendor}/${id}`);
      warnings.push(`${vendor}: keeping retired models: ${[...retired].sort().join(", ")}`);
    }

    for (const [id, incoming] of Object.entries(models)) {
      if (!isValidModelId(id)) {
        warnings.push(`${vendor}: rejected invalid or noisy model id "${id}"`);
        continue;
      }

      const current = currentModels[id];
      const currency = incoming.currency ?? current?.currency ?? "USD";
      const prices = extractPrices(incoming);
      let sanityFailed = false;

      for (const { path, value } of prices) {
        const check = validatePriceSanity(value, { currency, modelId: id, vendor });
        if (!check.valid) {
          warnings.push(`${vendor}/${id}: rejected price sanity violation for ${path}: ${check.reason}`);
          sanityFailed = true;
          break;
        }
      }
      if (sanityFailed) {
        continue;
      }

      if (!current) {
        currentModels[id] = { ...incoming, cachedInputPerMillion: incoming.cachedInputPerMillion ?? null };
        added.push(`${vendor}/${id}`);
        catalogChanged = true;
        continue;
      }

      if (!entriesEqual(current, incoming)) {
        // Delta guard: check for price mutations > 50%
        const deltas = checkPriceDeltas(current, incoming, { vendor, id });
        for (const delta of deltas) {
          const pct = (delta.ratio * 100).toFixed(1);
          warnings.push(
            `${vendor}/${id}: price delta on ${delta.path} exceeded 50% (${delta.prevVal} -> ${delta.nextVal}, ${pct}%)`,
          );
          priceDeltaAnomalies.push(delta);
        }

        currentModels[id] = { ...incoming, cachedInputPerMillion: incoming.cachedInputPerMillion ?? null };
        modified.push(`${vendor}/${id}`);
        catalogChanged = true;
      }
    }

    if (catalogChanged) {
      catalogs[vendor] = { ...catalog, models: currentModels };
    }
  }

  return { data: { ...existing, catalogs }, added, modified, keptRetired, warnings, acceptedVendors, priceDeltaAnomalies };
}

/**
 * Evaluates the risk level for auto-merge gatekeeping in pricing refresh.
 * @param {{
 *   warnings?: string[],
 *   fetchErrors?: string[],
 *   added?: string[],
 *   modified?: string[],
 *   priceDeltaAnomalies?: Array<{ vendor: string, id: string, path: string, prevVal: any, nextVal: any, ratio: number }>
 * }} [options]
 * @returns {{ riskLevel: "green" | "yellow" | "red", isSafeForAutoMerge: boolean, reasons: string[] }}
 */
export function evaluatePricingRisk({
  warnings = [],
  fetchErrors = [],
  added = [],
  modified = [],
  priceDeltaAnomalies = [],
} = {}) {
  const reasons = [];
  let isRed = false;
  let isYellow = false;

  // Red light conditions:
  if (fetchErrors.length > 0) {
    isRed = true;
    reasons.push(`${fetchErrors.length} fetch/parse error(s) occurred`);
  }
  if (warnings.some((w) => /skipped vendor entirely|model count dropped/i.test(w))) {
    isRed = true;
    reasons.push("Circuit breaker triggered (vendor skipped or model count dropped)");
  }
  if (warnings.some((w) => /flood risk/i.test(w))) {
    isRed = true;
    reasons.push("Flood risk triggered (>5 new models from single vendor)");
  }
  if (warnings.some((w) => /price sanity violation/i.test(w))) {
    isRed = true;
    reasons.push("Price sanity check failed");
  }

  // Yellow light conditions:
  if (priceDeltaAnomalies.length > 0 || warnings.some((w) => /price delta on/i.test(w))) {
    isYellow = true;
    reasons.push(`Price mutation anomaly detected (>50% delta on ${priceDeltaAnomalies.length} field(s))`);
  }
  if (warnings.length > 0) {
    isYellow = true;
    reasons.push(`${warnings.length} warning(s) reported`);
  }
  if (added.length > 3) {
    isYellow = true;
    reasons.push(`Batch addition: ${added.length} models added (threshold: <= 3 for green)`);
  }

  let riskLevel = "green";
  if (isRed) {
    riskLevel = "red";
  } else if (isYellow) {
    riskLevel = "yellow";
  }

  return {
    riskLevel,
    isSafeForAutoMerge: riskLevel === "green",
    reasons,
  };
}

// Serialize pricing the same way data/pricing.json is formatted.
export function formatPricing(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// Validate against the zod schema, returning the original object unchanged.
// We deliberately do NOT re-serialize through zod: re-serializing would strip
// the flat top-level fields (currency/inputPerMillion/...) that tiered entries
// keep for legacy clients, and would touch vendors the scrape didn't change.
export function validatePricing(data) {
  return validateRemotePricing(data);
}
