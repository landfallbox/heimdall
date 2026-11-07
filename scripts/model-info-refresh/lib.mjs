// Shared helpers for the model-info refresh scripts: fetching, token-value
// parsing, and the merge logic for data/model-info.json.
import {
  isValidModelId,
  MODEL_ID_REGEX,
  NOISE_WORDS,
  parseRemoteModelInfo,
} from "../../src/model-info-schema.ts";

export { isValidModelId, MODEL_ID_REGEX, NOISE_WORDS };

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

// Parse a token count like "1M tokens", "128K", "1,048,576", "256k" into an
// integer. Returns null when the value cannot be interpreted.
export function parseTokenValue(raw) {
  if (typeof raw !== "string") return null;
  const match = raw.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([kKmM]?)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  const suffix = match[2].toLowerCase();
  const multiplier = suffix === "k" ? 1024 : suffix === "m" ? 1024 * 1024 : 1;
  const tokens = Math.round(value * multiplier);
  return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
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

// Merge newly scraped model info into the existing data. The merge only adds
// or modifies models: retired models are never deleted and manual-only fields
// (displayName, supportsReasoningEffort) are never overwritten.
//
// `vendorScrapes` is an array of { vendor, models, baselineIds }:
//   - models: the model ids this run scraped for the vendor (raw model ids,
//     matching the keys used in data/model-info.json).
//   - baselineIds: the model ids the vendor is expected to own, used by the
//     circuit breaker to detect a scrape that lost most of its models.
//
// Returns { data, added, modified, keptRetired, warnings } where data is the
// merged (unvalidated) object.
export function mergeModelInfo(existing, vendorScrapes) {
  const models = { ...(existing.models ?? {}) };
  const added = [];
  const modified = [];
  const keptRetired = [];
  const warnings = [];

  for (const { vendor, models: scraped, baselineIds } of vendorScrapes) {
    const scrapedIds = new Set(Object.keys(scraped));
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

    // Flood protection: single vendor adding > 5 new unknown models
    const newVendorModels = Object.keys(scraped).filter((id) => isValidModelId(id) && !baseline.has(id));
    if (baseline.size > 0 && newVendorModels.length > 5) {
      warnings.push(
        `${vendor}: flood risk: abnormally large batch of new models (${newVendorModels.length} new models; threshold: 5)`,
      );
    }

    const retiredForVendor = [...baseline].filter((id) => !scrapedIds.has(id));
    if (retiredForVendor.length > 0) {
      keptRetired.push(...retiredForVendor);
      warnings.push(`${vendor}: keeping retired models: ${[...retiredForVendor].sort().join(", ")}`);
    }

    for (const [id, incoming] of Object.entries(scraped)) {
      if (!isValidModelId(id)) {
        warnings.push(`${vendor}: rejected invalid or noisy model id "${id}"`);
        continue;
      }

      const nextIncoming = { ...incoming };
      if (nextIncoming.contextWindow !== undefined && (nextIncoming.contextWindow < 1000 || nextIncoming.contextWindow > 10000000)) {
        warnings.push(
          `${vendor}: rejected invalid contextWindow ${nextIncoming.contextWindow} for model "${id}" (expected 1,000 - 10,000,000)`,
        );
        delete nextIncoming.contextWindow;
      }

      const current = models[id];
      if (!current) {
        models[id] = nextIncoming;
        added.push(id);
        continue;
      }
      const next = { ...current };
      if (nextIncoming.contextWindow !== undefined && nextIncoming.contextWindow !== current.contextWindow) {
        next.contextWindow = nextIncoming.contextWindow;
      }
      if (nextIncoming.maxOutputTokens !== undefined && nextIncoming.maxOutputTokens !== current.maxOutputTokens) {
        next.maxOutputTokens = nextIncoming.maxOutputTokens;
      }
      if (nextIncoming.capabilities) {
        const capabilities = { ...(current.capabilities ?? {}) };
        for (const key of ["toolCalling", "vision", "thinking"]) {
          if (nextIncoming.capabilities[key] !== undefined && nextIncoming.capabilities[key] !== capabilities[key]) {
            capabilities[key] = nextIncoming.capabilities[key];
          }
        }
        next.capabilities = capabilities;
      }
      // displayName and supportsReasoningEffort are manual-only: never touched.
      const changed = JSON.stringify(next) !== JSON.stringify(current);
      if (changed) {
        models[id] = next;
        modified.push(id);
      }
    }
  }

  return { data: { ...existing, models }, added, modified, keptRetired, warnings };
}

/**
 * Evaluates the risk level for auto-merge gatekeeping in model-info refresh.
 * @param {{
 *   warnings?: string[],
 *   fetchErrors?: string[],
 *   added?: string[],
 *   modified?: string[]
 * }} [options]
 * @returns {{ riskLevel: "green" | "yellow" | "red", isSafeForAutoMerge: boolean, reasons: string[] }}
 */
export function evaluateModelInfoRisk({
  warnings = [],
  fetchErrors = [],
  added = [],
  modified = [],
} = {}) {
  const reasons = [];
  let isRed = false;
  let isYellow = false;

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

// Serialize model info the same way data/model-info.json is formatted.
export function formatModelInfo(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// Re-serialize through the zod schema so the output stays valid.
export function validateModelInfo(data) {
  return parseRemoteModelInfo(data);
}
