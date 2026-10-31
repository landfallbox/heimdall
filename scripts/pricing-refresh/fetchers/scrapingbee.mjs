// Fetches the SenseCore pricing page through ScrapingBee's residential proxy
// pool (https://www.scrapingbee.com). The page's WAF blocks datacenter IPs
// (GitHub Actions, AWS) with a "请求已被阻断" interstitial while residential
// IPs get through, so a direct fetch from CI can never work.
//
// Requires the SCRAPINGBEE_API_KEY environment variable (GitHub secret).
// Free tier: 1,000 credits/month; premium_proxy + render_js=false costs
// 10 credits per request, so the daily refresh uses ~300/month.
//
// render_js=false is safe: the pricing page is server-rendered (Next.js),
// the tables are in the initial HTML.
//
// Without a key this fails fast with a clear error instead of fetching
// directly (a direct fetch would just hit the WAF block page).
const ENDPOINT = "https://app.scrapingbee.com/api/v1";
const TIMEOUT_MS = 30000;
const RETRIES = 2;

// Signature of the WAF interstitial (HTTP 200, ~123-148KB, no tables).
const WAF_BLOCK = /请求已被阻断/;

export async function fetchText(url) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "sensenova: SCRAPINGBEE_API_KEY is not set; the SenseCore WAF blocks datacenter IPs, so this page can only be fetched through a residential proxy (ScrapingBee)",
    );
  }
  const endpoint = `${ENDPOINT}?${new URLSearchParams({
    url,
    premium_proxy: "true",
    render_js: "false",
  }).toString()}`;

  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    try {
      const html = await fetchOnce(endpoint, apiKey, TIMEOUT_MS);
      if (WAF_BLOCK.test(html)) {
        throw new Error("sensenova: blocked by the SenseCore WAF even via residential proxy");
      }
      return html;
    } catch (error) {
      lastError = error;
      // HTTP errors (bad key, out of credits, WAF block) are deterministic;
      // only network-level failures are retried.
      if (/HTTP \d{3}/.test(error.message) || /WAF/.test(error.message)) throw error;
    }
  }
  throw lastError;
}

async function fetchOnce(endpoint, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body ? `: ${body.slice(0, 200)}` : "";
      throw new Error(`ScrapingBee -> HTTP ${response.status}${detail}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
