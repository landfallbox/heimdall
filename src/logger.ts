import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { isPlainObject } from "./config.ts";

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

type LogLevel = keyof typeof LOG_LEVELS;

export type Logger = {
  debug: (event: string, data?: Record<string, unknown>) => void;
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
  close: (callback?: () => void) => void;
};

function resolveLogLevel(value: unknown): LogLevel {
  const normalized = String(value || "info").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized) ? (normalized as LogLevel) : "info";
}

export const LOGS_DIRECTORY = "logs";
export const LOG_FILE_PREFIX = "router-";
export const LEGACY_LOG_FILE = "router.log";

export function formatLogDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function logFileName(date: Date): string {
  return `${LOG_FILE_PREFIX}${formatLogDate(date)}.log`;
}

/**
 * Creates the process logger. Writes JSONL to `<runtimeRoot>/logs/router-YYYY-MM-DD.log`
 * (local timezone), rolling to a new file when the date changes.
 * Sensitive fields are redacted recursively before serialization.
 */
export function createLogger(runtimeRoot: string, options: { dateProvider?: () => Date } = {}): Logger {
  const dateProvider = options.dateProvider || (() => new Date());
  const logDirectory = join(resolve(runtimeRoot), LOGS_DIRECTORY);
  mkdirSync(logDirectory, { recursive: true });

  const threshold = LOG_LEVELS[resolveLogLevel(process.env.HEIMDALL_LOG_LEVEL)];

  let stream: WriteStream | null = null;
  let activeDate = "";

  const openStream = (date: string): WriteStream => {
    const next = createWriteStream(join(logDirectory, `${LOG_FILE_PREFIX}${date}.log`), { flags: "a" });
    next.on("error", (error) => {
      console.error(JSON.stringify({
        time: new Date().toISOString(),
        level: "error",
        event: "log_stream_failed",
        errorMessage: error.message,
      }));
    });
    return next;
  };

  const log = (level: LogLevel, event: string, data: Record<string, unknown> = {}) => {
    if (LOG_LEVELS[level] < threshold) {
      return;
    }
    const date = formatLogDate(dateProvider());
    if (date !== activeDate) {
      stream?.end();
      activeDate = date;
      stream = openStream(date);
    }
    // 首次写入必然进入换文件分支（activeDate 初始为空），此处 stream 实际必非空
    if (!stream) {
      return;
    }
    writeLog(stream, level, event, data);
  };

  return {
    debug: (event, data) => log("debug", event, data),
    info: (event, data) => log("info", event, data),
    warn: (event, data) => log("warn", event, data),
    error: (event, data) => log("error", event, data),
    close: (callback) => {
      if (!stream) {
        callback?.();
        return;
      }
      stream.end(callback);
    },
  };
}

function writeLog(stream: WriteStream, level: LogLevel, event: string, data: Record<string, unknown>) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...(redact(data) as Record<string, unknown>),
  });
  stream.write(`${line}\n`);

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /api[_-]?key|authorization|token|secret/i.test(key) ? "[redacted]" : redact(item);
  }
  return result;
}
