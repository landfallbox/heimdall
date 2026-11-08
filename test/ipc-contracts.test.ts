import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ipcContractChannels,
  ipcEventChannels,
  parseIpcEvent,
  parseIpcRequest,
  parseIpcResponse,
} from "../gui/electron/ipc-contracts.ts";

const health = {
  ok: true,
  status: 200,
  url: "http://127.0.0.1:4000/health",
  body: { ok: true },
  text: "{\"ok\":true}",
  processCount: 0,
};

assert.deepEqual(parseIpcRequest("router:start", []), []);
assert.deepEqual(parseIpcRequest("repo:openRepo", []), []);
assert.deepEqual(parseIpcRequest("app:setTheme", ["dark"]), ["dark"]);
assert.throws(
  () => parseIpcRequest("app:setTheme", ["bogus"]),
  /Invalid IPC request for app:setTheme: 0/,
);
assert.deepEqual(
  parseIpcRequest("logs:read", [{ limit: 80, cursor: "cm91dGVyLTIwMjYtMDEtMDEubG9n", levels: ["error"], keyword: "REQ-1", startTime: 1, endTime: 2 }]),
  [{ limit: 80, cursor: "cm91dGVyLTIwMjYtMDEtMDEubG9n", levels: ["error"], keyword: "REQ-1", startTime: 1, endTime: 2 }],
);
assert.deepEqual(
  parseIpcRequest("logs:read", [{ cursor: null }]),
  [{ cursor: null }],
);
assert.deepEqual(
  parseIpcRequest("usage:summary", [{ vendor: "vendor-a", model: "gpt-5-mini" }]),
  [{ vendor: "vendor-a", model: "gpt-5-mini" }],
);
assert.equal((parseIpcResponse("router:start", { started: true, via: "process", pid: 1234, health }) as any).health.ok, true);
assert.deepEqual(parseIpcResponse("repo:openRepo", { ok: true }), { ok: true });

assert.throws(
  () => parseIpcRequest("logs:read", [{ limit: "80" }]),
  /Invalid IPC request for logs:read: 0\.limit/,
);
assert.throws(
  () => parseIpcRequest("usage:summary", [{ vendor: 42 }]),
  /Invalid IPC request for usage:summary: 0\.vendor/,
);
assert.throws(
  () => parseIpcResponse("router:start", { started: true, health: { ...health, processCount: "0" } }),
  /Invalid IPC response for router:start: health\.processCount/,
);
assert.throws(
  () => parseIpcRequest("unknown:channel", []),
  /Missing IPC request contract for unknown:channel/,
);

assert.deepEqual(
  parseIpcEvent("logs:appended", { lines: ["{\"a\":1}", "{\"b\":2}"], ts: 1700000000000 }),
  { lines: ["{\"a\":1}", "{\"b\":2}"], ts: 1700000000000 },
);
assert.throws(
  () => parseIpcEvent("logs:appended", { lines: "not-an-array", ts: 1 }),
  /Invalid IPC event for logs:appended: lines/,
);
assert.throws(
  () => parseIpcEvent("unknown:event", {}),
  /Missing IPC event contract for unknown:event/,
);

const mainSource = readFileSync(new URL("../gui/electron/main.ts", import.meta.url), "utf8");
const registeredChannels = [...mainSource.matchAll(/registerIpcHandler\("([^"]+)"/g)].map((match) => match[1]).sort();
assert.deepEqual([...ipcContractChannels].sort(), registeredChannels);
const sentChannels = [...mainSource.matchAll(/webContents\.send\("([^"]+)"/g)].map((match) => match[1]);
for (const channel of ipcEventChannels) {
  assert.ok(sentChannels.includes(channel), `main.ts never sends event ${channel}`);
}

console.log("IPC contract tests passed");