import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupOldLogs, listLogFiles, readLogPage, resolveLogDirectory } from "../gui/electron/log-store.ts";

assert.equal(resolveLogDirectory("/data"), join("/data", "logs"));

function makeDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const logDirectory = join(root, "logs");
  mkdirSync(logDirectory, { recursive: true });
  return logDirectory;
}

function writeLines(logDirectory: string, name: string, lines: string[]): void {
  writeFileSync(join(logDirectory, name), lines.map((line) => `${line}\n`).join(""), "utf8");
}

// 2. 文件清单：日期倒序 + legacy 最旧
{
  const dir = makeDir("log-store-list-");
  try {
    writeLines(dir, "router-2026-01-01.log", ["a"]);
    writeLines(dir, "router-2026-01-03.log", ["c"]);
    writeLines(dir, "router-2026-01-02.log", ["b"]);
    writeLines(dir, "router.log", ["legacy"]);
    writeFileSync(join(dir, "unrelated.txt"), "x\n", "utf8");
    assert.deepEqual(await listLogFiles(dir), ["router-2026-01-03.log", "router-2026-01-02.log", "router-2026-01-01.log", "router.log"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. 跨文件分页：三文件各 40 行，limit 30，逐页取完，旧→新且无重复
{
  const dir = makeDir("log-store-paging-");
  const expected: string[] = [];
  try {
    for (const [name, prefix] of [["router-2026-01-01.log", "old"], ["router-2026-01-02.log", "mid"], ["router-2026-01-03.log", "new"]] as const) {
      const lines = Array.from({ length: 40 }, (_, i) => `${prefix}-${i.toString().padStart(2, "0")}`);
      writeLines(dir, name, lines);
      expected.push(...lines);
    }
    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await readLogPage(dir, { limit: 30, cursor });
      collected.unshift(...page.lines);
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages < 20, "分页应终止");
    } while (cursor !== null);
    assert.deepEqual(collected, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 4. 单文件内游标续读（不跨文件）
{
  const dir = makeDir("log-store-cursor-");
  try {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`);
    writeLines(dir, "router-2026-01-01.log", lines);
    const page1 = await readLogPage(dir, { limit: 40, cursor: null });
    assert.equal(page1.lines.length, 40);
    assert.deepEqual(page1.lines, lines.slice(60));
    assert.equal(page1.hasMore, true);
    assert.ok(page1.nextCursor);
    const page2 = await readLogPage(dir, { limit: 40, cursor: page1.nextCursor });
    assert.deepEqual(page2.lines, lines.slice(20, 60));
    const page3 = await readLogPage(dir, { limit: 40, cursor: page2.nextCursor });
    assert.deepEqual(page3.lines, lines.slice(0, 20));
    assert.equal(page3.hasMore, false);
    assert.equal(page3.nextCursor, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 5. 游标指向已删除文件 → 回退到更旧的现存文件
{
  const dir = makeDir("log-store-cursor-fallback-");
  try {
    writeLines(dir, "router-2026-01-01.log", ["old-0", "old-1"]);
    writeLines(dir, "router-2026-01-02.log", ["mid-0", "mid-1"]);
    const newLines = Array.from({ length: 40 }, (_, i) => `new-${i.toString().padStart(2, "0")}`);
    writeLines(dir, "router-2026-01-03.log", newLines);
    // 游标落在 01-03 文件内部（未耗尽）
    const page1 = await readLogPage(dir, { limit: 10, cursor: null });
    assert.deepEqual(page1.lines, newLines.slice(30));
    assert.ok(page1.nextCursor);
    // 删除 01-03 后继续翻页 → 回退到 01-02 末尾，跨文件取完（整体仍旧→新）
    rmSync(join(dir, "router-2026-01-03.log"));
    const page2 = await readLogPage(dir, { limit: 5, cursor: page1.nextCursor });
    assert.deepEqual(page2.lines, ["old-0", "old-1", "mid-0", "mid-1"]);
    assert.equal(page2.hasMore, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 6. 服务端过滤：level / vendor / model 前缀 / keyword 大小写不敏感 / 时间范围
{
  const dir = makeDir("log-store-filter-");
  try {
    const t = (offsetMinutes: number) => new Date(Date.UTC(2026, 0, 2, 12, 0) + offsetMinutes * 60_000).toISOString();
    const lines = [
      JSON.stringify({ time: t(0), level: "info", event: "start", vendor: "openai", model: "gpt-4o" }),
      JSON.stringify({ time: t(1), level: "error", event: "fail", vendor: "openai", model: "gpt-4o-mini", requestId: "REQ-123" }),
      JSON.stringify({ time: t(2), level: "warn", event: "slow", vendor: "anthropic", model: "claude-3" }),
      JSON.stringify({ time: t(3), level: "info", event: "ok", vendor: "anthropic", model: "claude-3-opus" }),
      JSON.stringify({ time: t(4), level: "error", event: "timeout", vendor: "openai", model: "gpt-4o", requestId: "req-456" }),
      "not-json-line",
    ];
    writeLines(dir, "router-2026-01-02.log", lines);

    const byLevel = await readLogPage(dir, { limit: 10, cursor: null, filter: { levels: ["error"] } });
    assert.equal(byLevel.lines.length, 2);
    assert.ok(byLevel.lines.every((line) => JSON.parse(line).level === "error"));

    const byVendor = await readLogPage(dir, { limit: 10, cursor: null, filter: { vendor: "anthropic" } });
    assert.equal(byVendor.lines.length, 2);

    const byModel = await readLogPage(dir, { limit: 10, cursor: null, filter: { model: "gpt-4o" } });
    assert.equal(byModel.lines.length, 3); // gpt-4o 前缀匹配 gpt-4o 与 gpt-4o-mini

    const byKeyword = await readLogPage(dir, { limit: 10, cursor: null, filter: { keyword: "REQ-123" } });
    assert.equal(byKeyword.lines.length, 1);
    assert.match(byKeyword.lines[0], /REQ-123/);

    const byTime = await readLogPage(dir, {
      limit: 10,
      cursor: null,
      filter: { startTime: Date.parse(t(1)), endTime: Date.parse(t(3)) },
    });
    assert.equal(byTime.lines.length, 3);

    // 过滤 + 分页：limit 1 时稀疏匹配逐条向前
    const sparse: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await readLogPage(dir, { limit: 1, cursor, filter: { levels: ["error", "warn"] } });
      sparse.unshift(...page.lines);
      cursor = page.nextCursor;
    } while (cursor !== null);
    assert.equal(sparse.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 7. 过滤无命中时 hasMore 语义
{
  const dir = makeDir("log-store-filter-exhaust-");
  try {
    writeLines(dir, "router-2026-01-01.log", ["a", "b", "c"]);
    const page = await readLogPage(dir, { limit: 10, cursor: null, filter: { keyword: "no-match" } });
    assert.deepEqual(page.lines, []);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 8. 空目录
{
  const dir = makeDir("log-store-empty-");
  try {
    const page = await readLogPage(dir, { limit: 10, cursor: null });
    assert.deepEqual(page, { dir, lines: [], nextCursor: null, hasMore: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 9. cleanupOldLogs：只删超期日期文件，保留近期、legacy 与无关文件
{
  const dir = makeDir("log-store-cleanup-");
  try {
    const date = (daysAgo: number) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    writeLines(dir, `router-${date(0)}.log`, ["today"]);
    writeLines(dir, `router-${date(10)}.log`, ["recent"]);
    writeLines(dir, `router-${date(31)}.log`, ["stale"]);
    writeLines(dir, "router.log", ["legacy"]);
    writeFileSync(join(dir, "notes.txt"), "keep\n", "utf8");

    const deleted = await cleanupOldLogs(dir, 30);
    assert.deepEqual(deleted, [`router-${date(31)}.log`]);
    const remaining = readdirSync(dir).sort();
    assert.ok(remaining.includes(`router-${date(0)}.log`));
    assert.ok(remaining.includes(`router-${date(10)}.log`));
    assert.ok(remaining.includes("router.log"));
    assert.ok(remaining.includes("notes.txt"));
    assert.ok(!remaining.includes(`router-${date(31)}.log`));

    // 幂等：再跑一次无删除
    assert.deepEqual(await cleanupOldLogs(dir, 30), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("log store tests passed");