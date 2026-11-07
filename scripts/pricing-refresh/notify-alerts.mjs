#!/usr/bin/env node
// Sends notifications (via GitHub Issue @mention to trigger emails) when
// pricing refresh encounters errors or circuit-breaker warnings.
//
// Automatically manages the lifecycle of alert issues:
// - Creates an issue with the "pricing-alert" label and @mentions the owner.
// - If an open alert issue already exists, comments on it instead of duplicating.
// - If all vendors are healthy and an open alert issue exists, closes it as resolved.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALERT_LABEL = "pricing-alert";

/**
 * Parses CLI arguments for notification options.
 * @param {string[]} argv
 * @returns {{ alertFile: string | null }}
 */
function parseArgs(argv) {
  const args = { alertFile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--alert-file") args.alertFile = argv[++i];
  }
  return args;
}

/**
 * Runs a GitHub CLI command synchronously and returns trimmed standard output.
 * @param {string[]} args
 * @returns {string}
 */
function gh(args) {
  return execFileSync("gh", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/**
 * Resolves repository owner, name, and slug from environment variables or git origin URL.
 * @returns {{ owner: string, name: string, repo: string }}
 */
function getRepoInfo() {
  const repoEnv = process.env.GITHUB_REPOSITORY;
  if (repoEnv && repoEnv.includes("/")) {
    const [owner, name] = repoEnv.split("/");
    return { owner, name, repo: repoEnv };
  }
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/(.*?)(?:\.git)?$/);
    if (m) return { owner: m[1], name: m[2], repo: `${m[1]}/${m[2]}` };
  } catch {}
  return { owner: "landfallbox", name: "heimdall", repo: "landfallbox/heimdall" };
}

/**
 * Appends markdown content to GitHub Step Summary if available in the environment.
 * @param {string} markdown
 * @returns {Promise<void>}
 */
async function writeStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      await appendFile(summaryPath, `\n\n${markdown}\n`, "utf8");
    } catch (e) {
      console.warn("Failed to write to GITHUB_STEP_SUMMARY:", e.message);
    }
  }
}

/**
 * Main routine: reads pricing alert report and delivers GitHub issue alerts or auto-closes resolved ones.
 * @returns {Promise<void>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.alertFile) {
    console.log("notify-alerts: no --alert-file provided; skipping");
    return;
  }

  const alertPath = path.resolve(ROOT, args.alertFile);
  if (!existsSync(alertPath)) {
    console.log(`notify-alerts: alert file ${args.alertFile} not found; skipping`);
    return;
  }

  const data = JSON.parse(readFileSync(alertPath, "utf8"));
  const { owner, repo } = getRepoInfo();
  const runId = process.env.GITHUB_RUN_ID || data.runId;
  const runUrl = runId ? `https://github.com/${repo}/actions/runs/${runId}` : null;

  const hasIssues = Boolean(data.hasErrors);
  const fetchErrors = data.fetchErrors ?? [];
  const severeWarnings = (data.warnings ?? []).filter((w) => /skipped vendor entirely/i.test(w));
  const priceDeltaAnomalies = data.priceDeltaAnomalies ?? [];
  const floodWarnings = (data.warnings ?? []).filter((w) => /flood risk/i.test(w));

  // Find any existing open alert issue.
  let openIssues = [];
  try {
    const raw = gh([
      "issue",
      "list",
      "--repo",
      repo,
      "--label",
      ALERT_LABEL,
      "--state",
      "open",
      "--json",
      "number,title",
    ]);
    openIssues = JSON.parse(raw);
  } catch (err) {
    console.warn("Could not list open alert issues:", err.message);
  }

  if (hasIssues) {
    const failedVendors = [
      ...new Set([
        ...fetchErrors.map((e) => e.split(":")[0].trim()),
        ...severeWarnings.map((w) => w.split(":")[0].trim()),
        ...floodWarnings.map((w) => w.split(":")[0].trim()),
        ...priceDeltaAnomalies.map((a) => a.vendor),
      ]),
    ].filter(Boolean);

    const titleVendorPart = failedVendors.length > 0 ? ` (${failedVendors.join(", ")})` : "";
    const title = `[Pricing Alert] 供应商价格更新风控报警${titleVendorPart}`;
    const bodyLines = [
      `@${owner}`,
      "",
      `### ⚠️ 模型价格定时更新风控报警`,
      "",
      `在最新的价格自动抓取任务中触发了防错校验或风控警报，相关 PR 已保持打开状态供人工审核：`,
      "",
      `**涉及供应商列表**：${failedVendors.length ? failedVendors.map((v) => `\`${v}\``).join(", ") : "无特定供应商"}`,
      "",
      "#### 详细告警信息",
    ];

    if (fetchErrors.length > 0) {
      for (const e of fetchErrors) bodyLines.push(`- ❌ 抓取错误: \`${e}\``);
    }
    if (severeWarnings.length > 0) {
      for (const w of severeWarnings) bodyLines.push(`- ⚠️ 熔断跳过: \`${w}\``);
    }
    if (floodWarnings.length > 0) {
      for (const f of floodWarnings) bodyLines.push(`- ⚠️ 新增泛滥: \`${f}\``);
    }
    if (priceDeltaAnomalies.length > 0) {
      bodyLines.push("");
      bodyLines.push("#### ⚠️ 价格突变告警 (变动幅度超过 50%)");
      for (const a of priceDeltaAnomalies) {
        const pct = (a.ratio * 100).toFixed(1);
        bodyLines.push(`- \`${a.vendor}/${a.id}\`: \`${a.path}\` 突变 ${pct}% (${a.prevVal} -> ${a.nextVal})`);
      }
    }
    if (data.reasons && data.reasons.length > 0) {
      bodyLines.push("");
      bodyLines.push("#### 门禁评估未通过原因");
      for (const r of data.reasons) {
        bodyLines.push(`- 🚫 ${r}`);
      }
    }

    bodyLines.push("");
    bodyLines.push("#### 正常变动情况");
    bodyLines.push(`- 新增模型: ${data.added?.length ? data.added.join(", ") : "无"}`);
    bodyLines.push(`- 修改价格: ${data.modified?.length ? data.modified.join(", ") : "无"}`);

    if (runUrl) {
      bodyLines.push("");
      bodyLines.push(`🔗 **GitHub Actions 日志**: [点击查看运行详情](${runUrl})`);
    }

    bodyLines.push("");
    bodyLines.push("> *该通知由 GitHub Actions 定时更新任务自动触发，GitHub 将直接发送提醒邮件到您的注册邮箱。*");

    const body = bodyLines.join("\n");

    let deliveryFailed = false;
    let deliveryError = null;

    if (openIssues.length > 0) {
      const issueNum = openIssues[0].number;
      try {
        gh(["issue", "comment", String(issueNum), "--repo", repo, "--body", body]);
        console.log(`Alert notification posted to open issue #${issueNum}`);
      } catch (err) {
        deliveryFailed = true;
        deliveryError = err;
        console.error(`Failed to comment on issue #${issueNum}:`, err.message);
      }
    } else {
      try {
        // Ensure the label exists.
        try {
          gh(["label", "create", ALERT_LABEL, "--repo", repo, "--description", "Automated pricing refresh alerts", "--color", "d73a4a"]);
        } catch {}
        const issueUrl = gh([
          "issue",
          "create",
          "--repo",
          repo,
          "--title",
          title,
          "--label",
          ALERT_LABEL,
          "--body",
          body,
        ]);
        console.log(`Created alert issue: ${issueUrl} (email triggered to @${owner})`);
      } catch (err) {
        deliveryFailed = true;
        deliveryError = err;
        console.error("Failed to create alert issue:", err.message);
      }
    }

    await writeStepSummary(
      `### ⚠️ Pricing Refresh Alert\n\n**Failed Vendors**: ${failedVendors.join(", ") || "none"}\n\n${fetchErrors.map((e) => `- ${e}`).join("\n")}${
        deliveryFailed ? `\n\n❌ **Notification Delivery Failed**: ${deliveryError?.message}` : ""
      }`,
    );

    if (deliveryFailed) {
      process.exitCode = 1;
    }
  } else {
    // Only close unresolved alerts after a successful full-vendor refresh;
    // a partial run (--only <vendor>) must not close global alerts.
    const pricingJsonPath = path.resolve(ROOT, "data", "pricing.json");
    let totalVendors = 11;
    if (existsSync(pricingJsonPath)) {
      try {
        const catalogs = JSON.parse(readFileSync(pricingJsonPath, "utf8")).catalogs ?? {};
        totalVendors = Object.keys(catalogs).length;
      } catch {}
    }
    const isFullRefresh = Array.isArray(data.vendorsRequested) && data.vendorsRequested.length >= totalVendors;

    if (isFullRefresh && openIssues.length > 0) {
      for (const item of openIssues) {
        try {
          const closeComment = `✅ 所有模型供应商价格抓取均已恢复正常。\n${runUrl ? `详情参见 [Run #${runId}](${runUrl})` : ""}`;
          gh(["issue", "comment", String(item.number), "--repo", repo, "--body", closeComment]);
          gh(["issue", "close", String(item.number), "--repo", repo]);
          console.log(`Auto-closed resolved alert issue #${item.number}`);
        } catch (err) {
          console.warn(`Could not close alert issue #${item.number}:`, err.message);
        }
      }
    } else if (openIssues.length > 0) {
      console.log("notify-alerts: run was partial (--only); keeping open alerts untouched");
    } else {
      console.log("notify-alerts: all vendors healthy; no alerts to send");
    }
  }
}

main().catch(async (err) => {
  console.error("notify-alerts failed:", err.message);
  try {
    await writeStepSummary(`### ❌ Pricing Alert Notification Failed\n\n${err.message}`);
  } catch {}
  process.exit(1);
});
