import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";

const tempDirectory = mkdtempSync(join(tmpdir(), "logger-test-"));
const logFile = join(tempDirectory, "router.log");
const baseConfig = normalizeConfig({});
const config = { ...baseConfig, router: { ...baseConfig.router, logFile } };

try {
  const logger = createLogger(config, tempDirectory);
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

  const lines = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
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

console.log("logger tests passed");
