/**
 * Compatibility shim for browser preview sessions that injected this URL via
 * Playwright addInitScript. The canonical mock now lives in
 * gui/src/mock-desktop-api.ts and is auto-loaded by main.tsx in dev builds;
 * this shim keeps the old URL working and always serves the latest mock.
 */
import("/src/mock-desktop-api.ts").catch(() => {
  // Outside the vite dev server (e.g. a production build) the module is not
  // served; the Electron preload bridge is authoritative there anyway.
});
