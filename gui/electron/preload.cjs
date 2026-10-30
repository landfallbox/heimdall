/**
 * Electron preload bridge.
 *
 * This file intentionally stays CommonJS: Electron preload scripts cannot
 * load ES modules or TypeScript. The renderer-facing surface it exposes is
 * declared as the `HeimdallDesktopApi` interface in `../src/desktop-api.ts`,
 * which the renderer imports for full type safety. Keep the two in sync.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("heimdall", {
  // Marker so the renderer can tell this real bridge apart from the
  // in-memory mock that main.tsx installs for plain-browser previews
  // (VS Code's integrated browser is Electron-based, so the user agent
  // alone cannot distinguish the two).
  __heimdallPreload: true,
  getState: () => ipcRenderer.invoke("app:getState"),
  rendererReady: () => ipcRenderer.invoke("app:rendererReady"),
  setTheme: (theme) => ipcRenderer.invoke("app:setTheme", theme),
  getOsDark: async () => Boolean((await ipcRenderer.invoke("app:osDark")).osDark),
  hideToTray: () => ipcRenderer.invoke("app:hideToTray"),
  cancelClose: () => ipcRenderer.invoke("app:cancelClose"),
  quitAndStop: () => ipcRenderer.invoke("app:quitAndStop"),
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  listVendorModels: (vendor) => ipcRenderer.invoke("vendor:listModels", vendor),
  startRouter: () => ipcRenderer.invoke("router:start"),
  stopRouter: () => ipcRenderer.invoke("router:stop"),
  restartRouter: () => ipcRenderer.invoke("router:restart"),
  checkHealth: (options) => ipcRenderer.invoke("router:health", options),
  readLogs: (options) => ipcRenderer.invoke("logs:read", options),
  readUsageSummary: (options) => ipcRenderer.invoke("usage:summary", options),
  loadPricingCache: () => ipcRenderer.invoke("pricing:loadCache"),
  loadModelInfoCache: () => ipcRenderer.invoke("model-info:loadCache"),
  openConfig: () => ipcRenderer.invoke("file:openConfig"),
  openLog: () => ipcRenderer.invoke("file:openLog"),
  getDataDirState: () => ipcRenderer.invoke("dataDir:getState"),
  pickDataDir: () => ipcRenderer.invoke("dataDir:pick"),
  changeDataDir: (target) => ipcRenderer.invoke("dataDir:change", { target }),
  openDataDir: () => ipcRenderer.invoke("dataDir:open"),
  getUpdateState: () => ipcRenderer.invoke("update:getState"),
  checkForUpdates: (options) => ipcRenderer.invoke("update:check", options),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openReleasePage: () => ipcRenderer.invoke("update:openReleasePage"),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:writeText", text),
  syncVsCodeModels: () => ipcRenderer.invoke("vscode:sync"),
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:openSettings", listener);
    return () => ipcRenderer.removeListener("app:openSettings", listener);
  },
  onConfigChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("config:changed", listener);
    return () => ipcRenderer.removeListener("config:changed", listener);
  },
  onConfirmClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:confirmClose", listener);
    return () => ipcRenderer.removeListener("app:confirmClose", listener);
  },
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  onOsDarkChange: (callback) => {
    const listener = (_event, osDark) => callback(Boolean(osDark));
    ipcRenderer.on("app:osDark", listener);
    return () => ipcRenderer.removeListener("app:osDark", listener);
  },
});
