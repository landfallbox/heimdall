// Parser for https://platform.kimi.ai/docs/pricing/chat (Moonshot Kimi).
//
// The page is a Next.js RSC payload. Each DocTable row is serialized as
//   [_jsx(_components.a,{href:`...`,children:`kimi-...`}),`$in / MTok`,`$out / MTok`,`$cached / MTok`,...]
// The K3 table carries 5 price cells (input, output, cached, 5m/1h cache
// writes); the K2 table carries 3. We take the first three.
import { parsePrice } from "../lib.mjs";

export async function parse(content) {
  const models = {};
  const anchorRe = /children:`(kimi-[a-z0-9.\-]+)`/g;
  let m;
  while ((m = anchorRe.exec(content)) !== null) {
    const id = m[1];
    const after = m.index + m[0].length;
    const closeIdx = content.indexOf("]", after);
    const region = closeIdx >= 0 ? content.slice(after, closeIdx) : content.slice(after, after + 400);
    const prices = [];
    const priceRe = /`(\$[\d.,]+)\s*\/\s*MTok`/g;
    let pm;
    while ((pm = priceRe.exec(region)) !== null) {
      const v = parsePrice(pm[1]);
      if (v != null) prices.push(v);
    }
    if (prices.length < 3) continue;
    models[id] = {
      currency: "USD",
      inputPerMillion: prices[0],
      outputPerMillion: prices[1],
      cachedInputPerMillion: prices[2],
    };
  }
  return models;
}
