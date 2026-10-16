#!/usr/bin/env node
/**
 * Automated diff-only security review for pull requests.
 *
 * Fetches the PR diff via the GitHub API, asks a configured OpenAI-compatible
 * LLM endpoint (same pattern as generate-release-notes.mjs) to review it
 * against the failure definitions in REVIEW.md, and posts the findings as a
 * PR comment.
 *
 * This job is informational: it never fails the PR. On any error it posts a
 * short note (when possible) and exits 0.
 *
 * Run via .github/workflows/security-review.yml (pull_request_target, base
 * branch checked out). The PR diff is read only as data via the GitHub API;
 * PR head code is never checked out or executed.
 *
 * Environment:
 *   GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_EVENT_NAME, GITHUB_TOKEN,
 *   GITHUB_EVENT_PATH
 *   SECURITY_REVIEW_API_KEY    bearer token for the LLM endpoint
 *   SECURITY_REVIEW_BASE_URL   OpenAI-compatible base URL
 *   SECURITY_REVIEW_MODEL      model id (default: Qwen3.8-27B)
 */

import { readFileSync } from "node:fs";

const LLM_TIMEOUT_MS = 300_000;
const MAX_DIFF_CHARS = 60_000;
const MAX_FINDINGS = 20;
const DEFAULT_BASE_URL = "http://122.193.22.119:8000/v1";
const DEFAULT_MODEL = "Qwen3.8-27B";

const FAILURE_CATEGORIES = [
  "failover 边界被破坏：响应已提交后仍切换供应商；该回退时没回退；不该回退（4xx 客户端错误、配置问题）时回退了",
  "敏感信息泄漏：API key、Authorization 头、上游响应体出现在日志、错误信息或 IPC 返回值中",
  "配置一致性破坏：绕过 config-store.ts 直接写配置；丢失 revision 校验或原子替换；无效配置破坏最后一份有效配置",
  "进程身份误判：终止 Router 前未匹配实例身份、只查 PID；引入 detached/unref() 破坏父子进程生命周期",
  "IPC 契约破坏：特权操作未走 guarded helper；请求或返回值缺 schema 校验",
  "熔断语义破坏：状态未按供应商+模型隔离；Half-open 放行多个探针；热加载重建熔断器语义错误",
].map((text, index) => `${index + 1}. ${text}`);

function env(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function serverUrl() {
  // REST API 请求需指向 api.github.com（GITHUB_API_URL），而非 GITHUB_SERVER_URL（github.com）。
  return env("GITHUB_API_URL", "https://api.github.com").replace(/\/+$/, "");
}

function repository() {
  return env("GITHUB_REPOSITORY", "landfallbox/heimdall");
}

function readEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} for ${url}`);
  }
  return response.json();
}

async function getPrDiff(prNumber) {
  const pr = await apiFetch(`${serverUrl()}/repos/${repository()}/pulls/${prNumber}`);
  const diffResponse = await fetch(pr.diff_url, {
    headers: {
      Accept: "application/vnd.github.diff",
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
    },
  });
  if (!diffResponse.ok) {
    throw new Error(`diff fetch returned ${diffResponse.status}`);
  }
  return diffResponse.text();
}

function buildPrompt(diff, truncated) {
  return `你是 Heimdall 仓库（本地 OpenAI 兼容模型路由器）的安全与正确性审查员。审查下面的 PR diff，只报告真实缺陷，不报告风格问题。

本仓库的失败定义（按严重度排序）：
${FAILURE_CATEGORIES.join("\n")}

审查规则：
- 每条发现必须给出 diff 中可见的文件名和行号作为证据；不能凭函数名猜测。
- 只报告本 PR 引入的问题；diff 中既有问题不算。
- 严重度取值：Important（可能导致数据丢失、泄漏、错误回退或崩溃）/ Nit（轻微）。
- 最多报告 ${MAX_FINDINGS} 条，宁缺毋滥；没有发现就输出空数组。

diff${truncated ? "（已截断，只包含前部分变更）" : ""}：
${diff}

只输出一个 JSON 数组，不要输出任何其他文字。每个元素格式：
{"file": "文件路径", "line": 行号, "severity": "Important 或 Nit", "category": "上述失败定义编号和名称", "description": "问题描述", "evidence": "diff 中的证据片段"}
没有发现时输出 []。`;
}

function extractJsonArray(text) {
  const cleaned = text
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON array in LLM response");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("LLM response is not a JSON array");
  }
  return parsed;
}

function normalizeFindings(raw) {
  return raw
    .filter((item) => item && typeof item === "object" && typeof item.description === "string" && item.description.trim())
    .slice(0, MAX_FINDINGS)
    .map((item) => ({
      file: String(item.file ?? "未知文件"),
      line: Number.isFinite(Number(item.line)) ? String(item.line) : "?",
      severity: item.severity === "Nit" ? "Nit" : "Important",
      category: String(item.category ?? ""),
      description: String(item.description).trim(),
      evidence: String(item.evidence ?? "").trim(),
    }));
}

function buildComment(findings, model) {
  if (findings.length === 0) {
    return [
      "## Security Review（自动，diff-only）",
      "",
      "没有发现。",
      "",
      "---",
      `_由 scripts/security-review.mjs 自动审查（模型：${model}）。发现未经人工验证；如有异议请在此线程说明。_`,
    ].join("\n");
  }
  const important = findings.filter((finding) => finding.severity === "Important").length;
  const nit = findings.length - important;
  const lines = [
    "## Security Review（自动，diff-only）",
    "",
    `${findings.length} 条发现（${important} Important，${nit} Nit）`,
  ];
  findings.forEach((finding, index) => {
    lines.push("", `### ${index + 1}. [${finding.severity}] ${finding.description}`);
    lines.push(`- **位置**：\`${finding.file}:${finding.line}\``);
    if (finding.category) {
      lines.push(`- **类别**：${finding.category}`);
    }
    if (finding.evidence) {
      lines.push(`- **证据**：\`${finding.evidence}\``);
    }
  });
  lines.push(
    "",
    "---",
    `_由 scripts/security-review.mjs 自动审查（模型：${model}）。发现未经人工验证，请逐条回应：修复或说明理由。_`,
  );
  return lines.join("\n");
}

async function postComment(prNumber, body) {
  await apiFetch(`${serverUrl()}/repos/${repository()}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

async function callLlm(prompt, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch(`${env("SECURITY_REVIEW_BASE_URL", DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("SECURITY_REVIEW_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`LLM endpoint returned ${response.status}`);
    }
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // 事件类型来自 GITHUB_EVENT_NAME 环境变量；webhook 负载本身不含 event_name 字段。
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    console.log("Not a pull_request event; skipping security review.");
    return;
  }
  const event = readEvent();
  const prNumber = event?.pull_request?.number;
  if (!prNumber) {
    console.log("No pull_request number in event payload; skipping security review.");
    return;
  }

  const apiKey = env("SECURITY_REVIEW_API_KEY");
  const model = env("SECURITY_REVIEW_MODEL", DEFAULT_MODEL);
  if (!apiKey) {
    console.log("SECURITY_REVIEW_API_KEY not configured; skipping security review.");
    return;
  }

  const diff = await getPrDiff(prNumber);
  if (!diff.trim()) {
    console.log("Empty PR diff; skipping security review.");
    return;
  }

  const truncated = diff.length > MAX_DIFF_CHARS;
  const diffForPrompt = truncated ? `${diff.slice(0, MAX_DIFF_CHARS)}\n...（diff 过长已截断）` : diff;
  console.log(`Reviewing PR #${prNumber}: diff ${diff.length} chars${truncated ? " (truncated)" : ""}.`);

  const findings = normalizeFindings(extractJsonArray(await callLlm(buildPrompt(diffForPrompt, truncated), model)));
  console.log(`Review produced ${findings.length} findings.`);
  await postComment(prNumber, buildComment(findings, model));
  console.log("Posted security review comment.");
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.log(`Security review failed: ${error.message || String(error)}`);
    const event = readEvent();
    const prNumber = event?.pull_request?.number;
    if (prNumber) {
      try {
        await postComment(
          prNumber,
          "## Security Review（自动，diff-only）\n\n本次自动审查执行失败，未产生发现。请人工确认本 PR 无安全影响。\n\n错误：`" +
            String(error.message || error).replace(/`/g, "'") +
            "`",
        );
      } catch (commentError) {
        console.log(`Failed to post failure note: ${commentError.message || String(commentError)}`);
      }
    }
    process.exit(0);
  });
