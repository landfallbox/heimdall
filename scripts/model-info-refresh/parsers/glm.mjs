// Parser for https://docs.bigmodel.cn/cn/guide/models (index page) plus the
// per-model detail pages (markdown, fetched as <path>.md).
//
// Detail pages carry:
//   - blockquotes: "> **上下文窗口**" / ">" / "> 1M" (same for 最大输出)
//   - "**Model Code**：`id-1`/`id-2`" (full-width colon, backtick ids)
//   - "## 能力支持" bullets: 思考模式 -> thinking, Function Calling ->
//     toolCalling, 视觉理解 -> vision
import { parseTokenValue } from "../lib.mjs";

const BASE = "https://docs.bigmodel.cn";
const HREF_RE = /\/cn\/guide\/models\/(?:text|vlm|image-generation|audio|embedding|rerank|ocr)\/[a-z0-9._-]+/g;

export async function parse(content, ctx) {
  // Normalize to extension-less paths: live sidebar hrefs carry a ".md"
  // suffix, fixtures do not.
  const paths = [...new Set([...content.matchAll(HREF_RE)].map((m) => m[0].replace(/\.md$/, "")))];
  const models = {};
  for (const path of paths) {
    const url = `${BASE}${path}.md`;
    let detail;
    try {
      detail = await ctx.fetchText(url);
    } catch (error) {
      ctx.warn?.(`glm: failed to fetch detail page ${url}: ${error.message}`);
      continue;
    }
    for (const [id, model] of Object.entries(parseDetail(detail, path))) {
      if (!(id in models)) models[id] = model;
    }
  }
  return models;
}

export function parseDetail(markdown, path) {
  // Normalize CRLF so line-anchored regexes work regardless of the
  // line endings in the fetched (or checked-out) markdown.
  markdown = markdown.replace(/\r\n/g, "\n");
  const ids = extractModelCodes(markdown, path);
  if (ids.length === 0) return {};

  const model = {};
  const contextWindow = blockquoteValue(markdown, "上下文窗口");
  if (contextWindow !== null) model.contextWindow = contextWindow;
  const maxOutputTokens = blockquoteValue(markdown, "最大输出");
  if (maxOutputTokens !== null) model.maxOutputTokens = maxOutputTokens;

  const capabilities = {};
  const section = capabilitiesSection(markdown);
  if (section) {
    for (const line of section.split("\n")) {
      if (!/^\*\s+/.test(line)) continue;
      if (/思考模式/.test(line)) capabilities.thinking = true;
      if (/Function Calling/i.test(line)) capabilities.toolCalling = true;
      if (/视觉理解/.test(line)) capabilities.vision = true;
    }
  }
  if (Object.keys(capabilities).length > 0) model.capabilities = capabilities;

  const models = {};
  for (const id of ids) models[id] = { ...model };
  return models;
}

// "> **label**" followed by the next non-empty ">" line.
function blockquoteValue(markdown, label) {
  const lines = markdown.split("\n");
  const labelRe = new RegExp(`^>\\s*\\*\\*${label}\\*\\*\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].startsWith(">")) break;
      const value = /^>\s*(\S.*)$/.exec(lines[j]);
      if (value) return parseTokenValue(value[1].trim());
    }
    return null;
  }
  return null;
}

// "**Model Code**：`id-1`/`id-2`" -> ids; falls back to the last path segment.
function extractModelCodes(markdown, path) {
  const line = markdown.split("\n").find((l) => /\*\*Model Code\*\*\s*[:：]/.test(l));
  if (line) {
    const ids = [...line.matchAll(/`([a-z0-9._-]+)`/gi)].map((m) => m[1]);
    if (ids.length > 0) return ids;
  }
  const segment = path.split("/").pop();
  return segment ? [segment] : [];
}

function capabilitiesSection(markdown) {
  const match = /##\s*能力支持[^\n]*\n([\s\S]*?)(?=\n##\s|\n# |$)/.exec(markdown);
  return match ? match[1] : null;
}
