import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const scenarioPath = join(moduleDirectory, "updater-scenario.ts");

function runScenario(mode: string): Promise<{ seq: Record<string, string>; states: string[] }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scenarioPath], {
      env: { ...process.env, HEIMDALL_MOCK_UPDATE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutStream = child.stdout!;
    const stderrStream = child.stderr!;
    let stdout = "";
    let stderr = "";
    stdoutStream.on("data", (chunk) => (stdout += chunk));
    stderrStream.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`scenario ${mode} exited ${code}\n${stderr}`));
        return;
      }
      const lastLine = stdout.trim().split("\n").pop()!;
      resolvePromise(JSON.parse(lastLine));
    });
  });
}

const available = await runScenario("available");
assert.equal(available.seq.initial, "idle");
assert.equal(available.seq.afterCheck, "available");
assert.equal(available.seq.afterDownload, "downloaded");
assert.equal(available.seq.afterInstall, "installed");

const notAvailable = await runScenario("not-available");
assert.equal(notAvailable.seq.initial, "idle");
assert.equal(notAvailable.seq.afterCheck, "not-available");

const error = await runScenario("error");
assert.equal(error.seq.afterCheck, "error");

const downloadError = await runScenario("download-error");
assert.equal(downloadError.seq.afterCheck, "available");
assert.equal(downloadError.seq.afterDownload, "error");

console.log("updater tests passed");
