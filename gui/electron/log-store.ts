import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

export const LOGS_DIRECTORY = "logs";
export const LEGACY_LOG_FILE = "router.log";
export const LOG_RETENTION_DAYS = 30;
export const DATED_LOG_FILE = /^router-(\d{4})-(\d{2})-(\d{2})\.log$/;

export function resolveLogDirectory(dataDirectory: string): string {
  return join(dataDirectory, LOGS_DIRECTORY);
}

export interface LogFilter {
  levels?: string[];
  vendor?: string;
  model?: string;
  keyword?: string;
  startTime?: number;
  endTime?: number;
}

export interface LogPage {
  dir: string;
  lines: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 日志文件清单，新→旧：日期文件倒序，遗留 `router.log` 最旧。 */
export async function listLogFiles(logDirectory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(logDirectory);
  } catch {
    return [];
  }
  const dated = entries.filter((name) => DATED_LOG_FILE.test(name)).sort().reverse();
  if (entries.includes(LEGACY_LOG_FILE)) {
    dated.push(LEGACY_LOG_FILE);
  }
  return dated;
}

// 游标：base64url("文件名\u0000字节偏移")；offset === -1 表示"从该文件末尾开始"
function encodeCursor(name: string, offset: number): string {
  return Buffer.from(`${name}\u0000${offset}`).toString("base64url");
}

function decodeCursor(cursor: string): { name: string; offset: number } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.indexOf("\u0000");
    if (separator <= 0) {
      return null;
    }
    const name = raw.slice(0, separator);
    const offset = Number(raw.slice(separator + 1));
    if (!Number.isInteger(offset) || offset < -1) {
      return null;
    }
    return { name, offset };
  } catch {
    return null;
  }
}

/**
 * 跨文件倒序分页读取：从最新文件末尾向前读，应用服务端过滤，
 * 凑满 limit 条或耗尽全部文件为止。游标编码"文件名 + 字节偏移"，
 * 游标文件已被清理时回退到"该日期之前最新的现存文件"。
 */
export async function readLogPage(
  logDirectory: string,
  { limit, cursor, filter }: { limit: number; cursor: string | null; filter?: LogFilter | null },
): Promise<LogPage> {
  const files = await listLogFiles(logDirectory);
  if (files.length === 0) {
    return { dir: logDirectory, lines: [], nextCursor: null, hasMore: false };
  }

  let startIndex = 0;
  let startOffset: number | null = null; // null = 从文件末尾开始
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      const index = files.indexOf(decoded.name);
      if (index !== -1) {
        startIndex = index;
        startOffset = decoded.offset;
      } else {
        // 游标文件已被清理：回退到比它更旧的第一个现存文件；
        // 没有更旧文件时视为已耗尽
        startIndex = firstOlderFileIndex(files, decoded.name);
        startOffset = null;
      }
    }
  }

  const lines: string[] = [];
  let lastFile: string | null = null;
  let lastNextOffset = 0;
  let lastExhausted = true;

  for (let index = startIndex; index < files.length && lines.length < limit; index += 1) {
    const name = files[index];
    const filePath = join(logDirectory, name);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    // startOffset 为 -1 表示"从该文件末尾开始"
    const end = index === startIndex && startOffset !== null && startOffset >= 0
      ? Math.min(startOffset, stat.size)
      : stat.size;
    if (end === 0) {
      lastFile = name;
      lastNextOffset = 0;
      lastExhausted = true;
      continue;
    }

    const handle = await fs.open(filePath, "r");
    try {
      const result = await scanFileBackwards(handle, end, limit - lines.length, filter ?? null);
      lines.unshift(...result.lines);
      lastFile = name;
      lastNextOffset = result.nextOffset;
      lastExhausted = result.fileExhausted;
    } finally {
      await handle.close();
    }
  }

  let nextCursor: string | null = null;
  let hasMore = false;
  if (lines.length >= limit && lastFile) {
    if (!lastExhausted) {
      nextCursor = encodeCursor(lastFile, lastNextOffset);
      hasMore = true;
    } else {
      const olderIndex = files.indexOf(lastFile) + 1;
      if (olderIndex < files.length) {
        nextCursor = encodeCursor(files[olderIndex], -1);
        hasMore = true;
      }
    }
  }

  return { dir: logDirectory, lines, nextCursor, hasMore };
}

interface ScanResult {
  lines: string[]; // 命中的原始行，旧→新
  nextOffset: number; // 已检查到的最旧完整行的起始字节偏移
  fileExhausted: boolean;
}

const CHUNK_SIZE = 16 * 1024;

/**
 * 从 end 偏移向前按 16KB 分块读取，逐行应用过滤，凑满 limit 条即停。
 * 行以 \n 为界（logger 恒以 \n 结尾），UTF-8 内容不影响按字节切行。
 */
async function scanFileBackwards(handle: FileHandle, end: number, limit: number, filter: LogFilter | null): Promise<ScanResult> {
  let position = end;
  let pending = Buffer.alloc(0); // 最旧的不完整行片段
  const lines: string[] = [];
  let nextOffset = end;
  let fileExhausted = false;

  while (position > 0 && lines.length < limit) {
    const length = Math.min(CHUNK_SIZE, position);
    position -= length;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead <= 0) {
      position = 0;
      break;
    }
    const combined = Buffer.concat([buffer.subarray(0, bytesRead), pending]);
    const atStart = position === 0;

    // 首个换行位置之前的内容（若未到文件头）是新的 pending
    let lineStart = 0;
    if (!atStart) {
      const firstNewline = combined.indexOf(0x0a);
      if (firstNewline === -1) {
        pending = combined;
        continue;
      }
      pending = combined.subarray(0, firstNewline + 1);
      lineStart = firstNewline + 1;
    }

    // 收集 [lineStart, combined.length) 内完整行的起始偏移（旧→新）
    const starts: number[] = [lineStart];
    for (let i = lineStart; i < combined.length; i += 1) {
      if (combined[i] === 0x0a) {
        starts.push(i + 1);
      }
    }

    // 从新到旧检查；凑满 limit 即停
    for (let i = starts.length - 1; i >= 0 && lines.length < limit; i -= 1) {
      const start = starts[i];
      const lineEnd = i + 1 < starts.length ? starts[i + 1] - 1 : combined.length;
      const raw = combined.subarray(start, lineEnd).toString("utf8").replace(/\r$/, "").trim();
      nextOffset = position + start;
      if (raw === "") {
        continue;
      }
      if (lineMatchesFilter(raw, filter)) {
        lines.unshift(raw);
      }
    }
  }

  // 文件头残留行（无换行结尾或尚未处理的最旧行）
  if (position === 0 && pending.length > 0 && lines.length < limit) {
    const raw = pending.toString("utf8").replace(/\r$/, "").trim();
    if (raw !== "" && lineMatchesFilter(raw, filter)) {
      lines.unshift(raw);
    }
    nextOffset = 0;
  }
  // 仅当已检查到文件头（offset 0）才算耗尽；
  // position 到 0 但 nextOffset > 0 说明是凑满 limit 提前停止，文件仍有更旧内容
  if (position === 0 && nextOffset === 0) {
    fileExhausted = true;
  }

  return { lines, nextOffset, fileExhausted };
}

function lineMatchesFilter(raw: string, filter: LogFilter | null): boolean {
  if (!filter) {
    return true;
  }
  const needsParsed = Boolean(
    filter.levels?.length || filter.vendor || filter.model
    || filter.startTime !== undefined || filter.endTime !== undefined,
  );
  let entry: Record<string, unknown> | null = null;
  if (needsParsed) {
    try {
      const parsed: unknown = JSON.parse(raw);
      entry = isPlainRecord(parsed) ? parsed : null;
    } catch {
      entry = null;
    }
    if (!entry) {
      return false;
    }
  }

  if (filter.levels?.length) {
    const level = typeof entry?.level === "string" ? entry.level : "";
    if (!filter.levels.includes(level)) {
      return false;
    }
  }
  if (filter.vendor && entry?.vendor !== filter.vendor) {
    return false;
  }
  if (filter.model) {
    const model = typeof entry?.model === "string" ? entry.model : "";
    if (!model.startsWith(filter.model)) {
      return false;
    }
  }
  if (filter.startTime !== undefined || filter.endTime !== undefined) {
    const time = entry ? Date.parse(String(entry.time ?? "")) : Number.NaN;
    if (!Number.isFinite(time)) {
      return false;
    }
    if (filter.startTime !== undefined && time < filter.startTime) {
      return false;
    }
    if (filter.endTime !== undefined && time > filter.endTime) {
      return false;
    }
  }
  if (filter.keyword && !raw.toLowerCase().includes(filter.keyword.toLowerCase())) {
    return false;
  }
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 在"日期倒序 + legacy 最旧"的文件清单中，返回比 name 更旧的第一个文件的索引；
 * 没有更旧文件时返回 files.length（视为已耗尽）。
 */
function firstOlderFileIndex(files: string[], name: string): number {
  if (!DATED_LOG_FILE.test(name)) {
    return files.length; // legacy 或未知文件名：没有更旧的文件
  }
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (file === LEGACY_LOG_FILE || file < name) {
      return i;
    }
  }
  return files.length;
}

/**
 * 删除早于 retentionDays 天的日期日志文件（只匹配 `router-YYYY-MM-DD.log`，
 * 遗留 `router.log` 与其它文件永不触碰）。返回已删除的文件名。
 */
export async function cleanupOldLogs(logDirectory: string, retentionDays: number = LOG_RETENTION_DAYS): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(logDirectory);
  } catch {
    return [];
  }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const deleted: string[] = [];
  for (const name of entries) {
    const match = DATED_LOG_FILE.exec(name);
    if (!match) {
      continue;
    }
    const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (fileDate < cutoff) {
      try {
        await fs.unlink(join(logDirectory, name));
        deleted.push(name);
      } catch {
        // 单个文件删除失败不阻塞其余清理
      }
    }
  }
  return deleted;
}

async function readLinesBefore(handle: FileHandle, end: number, limit: number): Promise<{ lines: string[]; start: number }> {
  const chunks: Buffer[] = [];
  let position = end;
  let lineBreaks = 0;
  const chunkSize = 16 * 1024;

  while (position > 0 && lineBreaks <= limit) {
    const length = Math.min(chunkSize, position);
    position -= length;
    const buffer = Buffer.allocUnsafe(length);
    await handle.read(buffer, 0, length, position);
    chunks.unshift(buffer);
    for (const byte of buffer) {
      if (byte === 10) {
        lineBreaks += 1;
      }
    }
  }

  const buffer = Buffer.concat(chunks);
  const text = buffer.toString("utf8");
  const lineStarts = [0];
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 10) {
      lineStarts.push(index + 1);
    }
  }

  const entries = text.split(/\r?\n/).filter(Boolean);
  const lines = entries.slice(-limit);
  const firstSelectedIndex = Math.max(0, entries.length - lines.length);
  return {
    lines,
    start: position + (lineStarts[firstSelectedIndex] || 0),
  };
}
