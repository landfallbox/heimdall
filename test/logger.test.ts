import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, formatLogDate, logFileName } from "../src/logger.ts";

const tempDirectory = mkdtempSync(join(tmpdir(), "logger-test-"));

try {
  const logger = createLogger(tempDirectory);
  logger.info("request_completed", {
    model: "gpt-5-mini",
    vendor: "vendor-a",
    apiKey: "sk-secret",
    api_key: "sk-underscore",
    "api-key": "sk-dash",
    ApiKey: "sk-camel",
    authorization: "Bearer abc",
    accessToken: "token-value",
    clientSecret: "cs-value",
    headers: { authorization: "Bearer nested", normal: "keep-me" },
    items: [{ token: "t1", count: 2 }],
  });
  logger.error("request_failed", { errorMessage: "boom", secret: "hidden" });
  await new Promise<void>((resolvePromise) => logger.close(resolvePromise));

  const todayFile = join(tempDirectory, "logs", logFileName(new Date()));
  const lines = readFileSync(todayFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const infoLine = lines.find((line) => line.event === "request_completed")!;
  assert.equal(infoLine.apiKey, "[redacted]");
  assert.equal(infoLine.api_key, "[redacted]");
  assert.equal(infoLine["api-key"], "[redacted]");
  assert.equal(infoLine.ApiKey, "[redacted]");
  assert.equal(infoLine.authorization, "[redacted]");
  assert.equal(infoLine.accessToken, "[redacted]");
  assert.equal(infoLine.clientSecret, "[redacted]");
  assert.equal(infoLine.headers.authorization, "[redacted]");
  assert.equal(infoLine.headers.normal, "keep-me");
  assert.equal(infoLine.items[0].token, "[redacted]");
  assert.equal(infoLine.items[0].count, 2);
  assert.equal(infoLine.model, "gpt-5-mini");
  assert.equal(infoLine.vendor, "vendor-a");

  const errorLine = lines.find((line) => line.event === "request_failed")!;
  assert.equal(errorLine.secret, "[redacted]");
  assert.equal(errorLine.errorMessage, "boom");
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

const tempDirectory2 = mkdtempSync(join(tmpdir(), "logger-rotate-test-"));

try {
  let currentDate = new Date(2026, 0, 5, 23, 59, 59);
  const logger = createLogger(tempDirectory2, {
    dateProvider: () => currentDate,
  });

  logger.info("first_day", { note: "day-1" });
  currentDate = new Date(2026, 0, 6, 0, 0, 1);
  logger.info("second_day", { note: "day-2" });
  await new Promise<void>((resolvePromise) => logger.close(resolvePromise));

  const day1File = join(tempDirectory2, "logs", logFileName(new Date(2026, 0, 5)));
  const day2File = join(tempDirectory2, "logs", logFileName(new Date(2026, 0, 6)));

  const day1Lines = readFileSync(day1File, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(day1Lines.map((line) => line.event), ["first_day"]);

  const day2Lines = readFileSync(day2File, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(day2Lines.map((line) => line.event), ["second_day"]);
} finally {
  rmSync(tempDirectory2, { recursive: true, force: true });
}

const tempDirectory3 = mkdtempSync(join(tmpdir(), "logger-close-test-"));

try {
  const logger = createLogger(tempDirectory3);
  await new Promise<void>((resolvePromise) => logger.close(resolvePromise));
} finally {
  rmSync(tempDirectory3, { recursive: true, force: true });
}

assert.equal(formatLogDate(new Date(2026, 0, 5)), "2026-01-05");
assert.equal(formatLogDate(new Date(2026, 11, 31)), "2026-12-31");
assert.equal(logFileName(new Date(2026, 0, 5)), "router-2026-01-05.log");

console.log("logger tests passed");
