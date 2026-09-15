import assert from "node:assert/strict";
import { healthDetail } from "../gui/electron/tray-controller.ts";

assert.equal(healthDetail(null), "No health result is available.");
assert.equal(healthDetail(undefined), "No health result is available.");
assert.equal(healthDetail({ ok: false, url: "", processCount: 0 } as never), "Router did not report healthy.");
assert.equal(healthDetail({ ok: false, error: "ECONNREFUSED", url: "http://x", processCount: 0 } as never), "ECONNREFUSED");
assert.equal(healthDetail({ ok: false, text: "upstream text", url: "http://x", processCount: 0 } as never), "upstream text");
assert.equal(healthDetail({ ok: false, url: "http://x", body: { model: "gpt-5-mini" }, processCount: 0 } as never), "gpt-5-mini");
assert.equal(healthDetail({ ok: true, url: "http://x", processCount: 1 } as never), "http://x");

console.log("tray-controller tests passed");
