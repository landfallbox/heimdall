import assert from "node:assert/strict";
import { getDesktopApi } from "../gui/src/desktop-api.ts";

const savedWindow = (globalThis as { window?: unknown }).window;

try {
  (globalThis as { window?: unknown }).window = {};
  assert.throws(() => getDesktopApi(), /Desktop API is unavailable/);

  const fakeApi = {
    getState: async () => ({ appName: "Heimdall" }),
    readLogs: async () => ({ path: "", lines: [], nextBefore: null, hasMore: false }),
  };
  (globalThis as { window?: unknown }).window = { heimdall: fakeApi };
  assert.equal(getDesktopApi(), fakeApi);
} finally {
  if (savedWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = savedWindow;
  }
}

console.log("desktop-api tests passed");
