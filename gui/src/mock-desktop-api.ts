/**
 * In-memory mock of the Heimdall desktop API for browser previews.
 *
 * In the Electron app (dev or packaged), gui/electron/preload.cjs installs
 * the real bridge before any page script runs; this module detects it via
 * the `__heimdallPreload` marker and stays a no-op. (The user agent alone
 * cannot work: VS Code's integrated browser is Electron-based too.) When
 * the vite dev server is opened in a plain browser, main.tsx loads this
 * module (dev builds only) so the UI can be exercised without the main
 * process.
 *
 * The mock keeps an in-memory config so saveConfig echoes back a full
 * normalized config plus a fresh revision, mirroring the IPC contracts in
 * gui/electron/ipc-contracts.ts.
 */
import type { HeimdallDesktopApi, SaveConfigResult } from "./desktop-api.ts";
import type { HealthState, LogPage, UsageSummary } from "./types.ts";

const hasRealPreload = Boolean(
  (window.heimdall as { __heimdallPreload?: boolean } | undefined)?.__heimdallPreload,
);

interface MockConfig {
  app: { closeBehavior: string; startAtLogin: boolean; syncVsCodeModels: boolean; updateChannel: string };
  router: {
    host: string;
    port: number;
    apiKey: string;
    requestTimeoutMs: number;
    maxBodyBytes: number;
    fallbackStatusCodes: number[];
    logFile: string;
  };
  vendors: Array<{
    name: string;
    baseUrl: string;
    models: Array<{ id: string; enabled: boolean; pricing?: Record<string, unknown> }>;
    authentication: string;
    apiKey?: string;
    apiKeyHeader: string;
    requestFormat: string;
    enabled: boolean;
  }>;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let revision = `mock-${Date.now().toString(16)}`;
let running = false;

const config: MockConfig = {
  app: { closeBehavior: "tray", startAtLogin: false, syncVsCodeModels: false, updateChannel: "stable" },
  router: {
    host: "127.0.0.1",
    port: 4000,
    apiKey: "mock-router-token",
    requestTimeoutMs: 30000,
    maxBodyBytes: 52428800,
    fallbackStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
    logFile: "logs/router.log",
  },
  vendors: [
    {
      name: "Mock Vendor",
      baseUrl: "https://api.example.com/v1",
      models: [
        { id: "mock-large", enabled: true },
        {
          id: "mock-small",
          enabled: true,
          pricing: {
            mode: "custom",
            currency: "USD",
            inputPerMillion: 1,
            cachedInputPerMillion: 0.1,
            outputPerMillion: 3,
          },
        },
      ],
      authentication: "api-key",
      apiKey: "sk-mock",
      apiKeyHeader: "authorization",
      requestFormat: "chat-completions",
      enabled: true,
    },
  ],
};

const endpoint = () => `http://${config.router.host}:${config.router.port}/v1`;

const health = (): HealthState => {
  const url = `${endpoint()}/health`;
  if (running) {
    const vendors = config.vendors
      .filter((vendor) => vendor.enabled)
      .map((vendor, index) => ({
        priority: index,
        models: vendor.models
          .filter((model) => model.enabled)
          .map((model) => ({ id: model.id, circuit: { state: "closed" } })),
      }));
    return {
      ok: true,
      status: 200,
      url,
      body: { model: "mock", instanceId: "mock-instance", vendors },
      processCount: 1,
      processLogPath: "logs/router.log",
    };
  }
  return {
    ok: false,
    url,
    error: `connect ECONNREFUSED ${config.router.host}:${config.router.port} (mock)`,
    processCount: 0,
  };
};

const enabledModelCount = () =>
  config.vendors.reduce(
    (count, vendor) => count + vendor.models.filter((model) => model.enabled).length,
    0,
  );

const vscodeSync = () => ({
  ok: true,
  filePath: "C:\\Users\\mock\\AppData\\Roaming\\Code\\User\\chatLanguageModels.json",
  modelCount: enabledModelCount(),
  createdProvider: false,
});

const emptyPeriod = () => ({
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  requestCount: 0,
  usageCoverage: 0,
  priceCoverage: 0,
  costs: [],
});

const idleUpdateState = () => ({
  status: "idle",
  supported: false,
  currentVersion: "0.0.0-mock",
  availableVersion: "",
  releaseName: "",
  releaseNotes: "",
  progress: null,
  error: "",
  lastCheckedAt: "",
});

const logLines = [
  "2026-10-14T01:00:00.000Z info  router started (mock) on 127.0.0.1:4000",
  "2026-10-14T01:00:05.000Z info  request mock-large 200 12ms (mock)",
  "2026-10-14T01:00:09.000Z warn  upstream timeout for mock-small, falling back (mock)",
];

if (!hasRealPreload) {
  const mock: HeimdallDesktopApi = {
    getState: async () => ({
      appName: "Heimdall",
      appVersion: "0.0.0-mock",
      isDevelopmentRuntime: true,
      config: clone(config),
      revision,
    }),
    loadConfig: async () => ({
      appName: "Heimdall",
      appVersion: "0.0.0-mock",
      isDevelopmentRuntime: true,
      config: clone(config),
      revision,
    }),
    saveConfig: async (payload) => {
      const next = payload?.config ?? payload;
      if (!next || typeof next !== "object") {
        throw new Error("Mock: saveConfig received no config.");
      }
      Object.assign(config, clone(next));
      revision = `mock-${Date.now().toString(16)}`;
      const result: SaveConfigResult = {
        config: clone(config),
        revision,
        applied: true,
        restartRequired: false,
        restartFields: [],
        reloadError: "",
      };
      if (config.app.syncVsCodeModels) {
        result.vsCodeSync = vscodeSync();
      }
      return result;
    },
    rendererReady: async () => undefined,
    hideToTray: async () => undefined,
    cancelClose: async () => undefined,
    quitAndStop: async () => undefined,
    listVendorModels: async (vendor) => {
      const models = (vendor as { models?: Array<{ id: string }> } | null)?.models ?? [];
      return { models: models.map((model) => model.id) };
    },
    startRouter: async () => {
      running = true;
      return { health: health(), started: true, via: "process" as const };
    },
    stopRouter: async () => {
      running = false;
      return { health: health(), stopped: true };
    },
    restartRouter: async () => {
      running = true;
      return { health: health(), started: true, via: "process" as const };
    },
    checkHealth: async () => health(),
    readLogs: async (): Promise<LogPage> => ({
      path: "logs/router.log (mock)",
      lines: logLines,
      nextBefore: null,
      hasMore: false,
    }),
    readUsageSummary: async (): Promise<UsageSummary> => ({
      filters: { vendor: "", model: "", vendors: [], models: [] },
      periods: { day: emptyPeriod(), week: emptyPeriod(), month: emptyPeriod() },
      daily: [],
    }),
    loadPricingCache: async () => ({ ok: false, data: null }),
    openConfig: async () => undefined,
    openLog: async () => undefined,
    getDataDirState: async () => ({
      dataDir: "C:\\Users\\demo\\AppData\\Roaming\\local.heimdall",
      defaultDataDir: "C:\\Users\\demo\\AppData\\Roaming\\local.heimdall",
      pointerPath: "C:\\Users\\demo\\AppData\\Roaming\\local.heimdall\\data-location.ini",
      editable: false,
      isCustom: false,
      warning: "",
    }),
    pickDataDir: async () => ({ canceled: true, path: "" }),
    changeDataDir: async () => {
      throw new Error("The data directory can only be changed in the installed app.");
    },
    openDataDir: async () => {
      // No file manager in the browser preview.
    },
    getUpdateState: async () => idleUpdateState(),
    checkForUpdates: async () => idleUpdateState(),
    downloadUpdate: async () => idleUpdateState(),
    installUpdate: async () => idleUpdateState(),
    openReleasePage: async () => undefined,
    writeClipboard: async (text) => {
      try {
        await navigator.clipboard.writeText(String(text));
      } catch {
        // Clipboard access can be unavailable in a plain browser tab.
      }
    },
    syncVsCodeModels: async () => vscodeSync(),
    onOpenSettings: () => undefined,
    onConfirmClose: () => undefined,
    onUpdateState: () => undefined,
    onConfigChanged: () => undefined,
  };

  window.heimdall = mock;
  console.info("[heimdall-mock] in-memory desktop API installed for browser preview");
}
