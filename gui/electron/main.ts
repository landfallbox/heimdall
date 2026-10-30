import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, renameSync, watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, normalizeConfig } from "../../src/config.ts";
import { getChatCompletionsUrl, getRouterBaseUrl } from "../../src/router-urls.ts";
import { loadModelInfoCache } from "../../src/model-info-updater.ts";
import { loadPricingCache } from "../../src/pricing-updater.ts";
import { readUsageSummary } from "../../src/usage-store.ts";
import { readConfigStore, revisionFor, writeConfigStore } from "./config-store.ts";
import {
  ensureDataDirUsable,
  formatDataDirPointer,
  isWithinDirectory,
  listMigrationConflicts,
  migrateDataDirContents,
  pointerFilePath,
  readDataDirPointer,
  sameDirectoryPath,
  validateDataDirTarget,
  writeDataDirPointer,
} from "./data-location.ts";
import { parseIpcRequest, parseIpcResponse } from "./ipc-contracts.ts";
import { syncVsCodeModels, type VsCodeSyncResult } from "../../src/vscode-sync.ts";
import { ensureLogFile, readLogPage, resolveLogPath } from "./log-store.ts";
import { createTrayController, healthDetail } from "./tray-controller.ts";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  initializeUpdater,
  installUpdate,
  onUpdateState,
  openReleasePage,
  REPO_URL,
} from "./updater.ts";
import type { HealthBody, HealthState, RouterActionResult, UpdateState } from "../src/types.ts";

type NormalizedConfig = ReturnType<typeof normalizeConfig>;

interface Paths {
  appDir: string;
  dataDir: string;
  configPath: string;
  serverPath: string;
  pidPath: string;
  packageRoot: string;
  nodePath: string;
}

interface ManagedRouterMetadata {
  pid: number;
  instanceId: string;
  managementToken: string;
  configPath: string;
  startedAt: string;
}

interface PendingRouterReload {
  resolve: (message: { applied?: boolean; restartRequired?: boolean; restartFields?: string[] }) => void;
  reject: (error: Error) => void;
}

interface RouterReloadResult {
  applied: boolean;
  restartRequired: boolean;
  restartFields: string[];
  reloadError: string;
}

interface HealthOptions {
  includeProcessCount?: boolean;
  managementToken?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const HIDDEN_START_ARGS = new Set(["--hidden", "--background", "--minimized", "--tray"]);
const isDevelopmentRuntime = process.env.HEIMDALL_DEV_MODE === "1";
const APP_DISPLAY_NAME = isDevelopmentRuntime ? "Heimdall Dev" : "Heimdall";
const APP_USER_MODEL_ID = isDevelopmentRuntime ? "local.heimdall.dev" : "local.heimdall";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let closePromptActive = false;
let routerLifecycleQueue: Promise<unknown> = Promise.resolve();
let managedRouterChild: ChildProcess | null = null;
const pendingRouterReloads = new Map<string, PendingRouterReload>();
const windowsToShowOnReady = new WeakSet<BrowserWindow>();

function resolveAppDir(): string {
  const candidates: (string | undefined)[] = [process.env.HEIMDALL_APP_DIR];

  if (app.isPackaged) {
    candidates.push(
      resolve(process.resourcesPath, "app.asar.unpacked"),
      resolve(process.resourcesPath, "app"),
    );
  }

  candidates.push(
    resolve(__dirname, "..", "..", "app"),
    resolve(__dirname, "..", ".."),
    resolve(process.resourcesPath || "", "app"),
  );

  for (const candidate of candidates.filter((value): value is string => Boolean(value))) {
    if (existsSync(join(candidate, "src", "server.ts"))) {
      return candidate;
    }
  }

  throw new Error("Could not find the router app directory.");
}

let defaultUserDataDir = "";
let dataDirFallbackWarning = "";
let dataDirRestartScheduled = false;

function resolvePointerDataDir(): string {
  const pointerPath = pointerFilePath(defaultUserDataDir);
  const target = readDataDirPointer(pointerPath);
  if (!target) {
    return "";
  }

  const check = validateDataDirTarget({
    target,
    currentDataDir: defaultUserDataDir,
    defaultUserDataDir,
    installDir: dirname(process.execPath),
  });

  if (!check.ok) {
    // A structurally invalid pointer (relative path, drive root, inside the
    // installation folder, ...) can never become valid, so reset it instead of
    // falling back on every start.
    resetDataDirPointer(pointerPath);
    dataDirFallbackWarning = `The recorded data directory "${target}" is invalid (${check.error}). The pointer was reset and Heimdall is using ${defaultUserDataDir}.`;
    return "";
  }

  if (!ensureDataDirUsable(check.path)) {
    // The path is valid but not reachable right now (an unplugged external
    // drive, for example). Keep the pointer so the data is found again once the
    // directory is reachable; falling back silently would let a second
    // config.json grow in the default folder, so the reason is surfaced in the
    // settings page and as a notification.
    dataDirFallbackWarning = `The data directory "${target}" is unavailable (not writable). Heimdall is using ${defaultUserDataDir} for this session.`;
    return "";
  }

  return check.path;
}

/** Synchronous because it runs before app ready, when the pointer was just found invalid. */
function resetDataDirPointer(pointerPath: string): void {
  try {
    mkdirSync(dirname(pointerPath), { recursive: true });
    const temporaryPath = `${pointerPath}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, formatDataDirPointer(null), "utf8");
    renameSync(temporaryPath, pointerPath);
  } catch {
    // A failed reset leaves the pointer in place; the fallback still applies.
  }
}

function getPaths(): Paths {
  const appDir = resolveAppDir();
  // For packaged builds the data directory is Electron's userData folder, which
  // configureRuntimeIdentity() redirects to the location stored in the pointer file.
  const dataDir = process.env.HEIMDALL_DATA_DIR || (app.isPackaged ? app.getPath("userData") : appDir);
  const configPath = process.env.ROUTER_CONFIG || join(dataDir, "config.json");
  const serverPath = join(appDir, "src", "server.ts");
  const pidPath = join(dataDir, "router.pid");
  const packageRoot = app.isPackaged ? process.resourcesPath : dirname(appDir);
  const nodePath = resolveNodePath(packageRoot);

  return {
    appDir,
    dataDir,
    configPath,
    serverPath,
    pidPath,
    packageRoot,
    nodePath,
  };
}

function resolveNodePath(packageRoot: string): string {
  if (process.env.HEIMDALL_NODE) {
    return process.env.HEIMDALL_NODE;
  }

  if (app.isPackaged && process.platform === "darwin") {
    return process.execPath;
  }

  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const candidates = [
    join(packageRoot, "bin", executableName),
    app.isPackaged ? join(process.resourcesPath, "bin", executableName) : "",
  ];

  for (const candidate of candidates.filter(Boolean)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return executableName;
}

function resolveAppIconPath(): string {
  const iconName = process.platform === "darwin" ? "icon.png" : "icon.ico";
  const candidates = [
    process.env.HEIMDALL_ICON,
    app.isPackaged ? join(process.resourcesPath, "assets", iconName) : "",
    resolve(__dirname, "..", "..", "build", iconName),
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function createAppIcon() {
  const iconPath = resolveAppIconPath();
  if (!iconPath) {
    return null;
  }

  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? null : icon;
}

function createTrayIcon() {
  if (process.platform !== "darwin") {
    return createAppIcon();
  }

  const candidates = [
    process.env.HEIMDALL_TRAY_ICON,
    app.isPackaged ? join(process.resourcesPath, "assets", "trayTemplate.png") : "",
    resolve(__dirname, "..", "..", "build", "trayTemplate.png"),
  ].filter((value): value is string => Boolean(value));
  const iconPath = candidates.find((candidate) => existsSync(candidate));
  if (!iconPath) {
    return null;
  }

  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    return null;
  }
  icon.setTemplateImage(true);
  return icon;
}

function ensureConfigFile(paths: Paths = getPaths()) {
  if (existsSync(paths.configPath)) {
    return;
  }

  mkdirSync(dirname(paths.configPath), { recursive: true });
  const defaultPort = clampNumber(process.env.HEIMDALL_DEFAULT_PORT, DEFAULT_CONFIG.router.port, 1, 65535);
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    router: {
      ...DEFAULT_CONFIG.router,
      port: defaultPort,
      apiKey: generateRouterApiKey(),
    },
  });
  writeFileSync(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function configureRuntimeIdentity() {
  const envUserDataDir = process.env.HEIMDALL_USER_DATA_DIR || "";
  // The pointer lives in the per-user default folder, and the env override moves
  // that whole identity so dev runs and tests never touch a real user profile.
  defaultUserDataDir = envUserDataDir || app.getPath("userData");

  // The env override wins (used by the dev runner and tests); otherwise a
  // packaged build honors the data directory stored by the installer or settings.
  const userDataDir = envUserDataDir || (app.isPackaged ? resolvePointerDataDir() : "");
  if (userDataDir) {
    mkdirSync(userDataDir, { recursive: true });
    app.setPath("userData", userDataDir);
  }

  if (isDevelopmentRuntime) {
    app.setName(APP_DISPLAY_NAME);
  }
}

function generateRouterApiKey(): string {
  return `lmr_${randomBytes(24).toString("base64url")}`;
}

// Revision of the config file as last seen by this app instance. Used to tell
// external on-disk edits apart from our own loads/writes.
let lastKnownConfigRevision = "";
let configWatcher: FSWatcher | null = null;
let configChangeTimer: NodeJS.Timeout | null = null;

/**
 * Watches the config file (via its parent directory, so atomic rename-based
 * writes are seen) and notifies the renderer when the file changes on disk
 * outside of this app.
 */
function startConfigWatcher() {
  if (configWatcher) {
    return;
  }

  const paths = getPaths();
  ensureConfigFile(paths);
  const configName = basename(paths.configPath);

  try {
    configWatcher = watch(dirname(paths.configPath), { persistent: false }, (_event, filename) => {
      if (filename !== null && filename !== configName) {
        return;
      }

      if (configChangeTimer) {
        clearTimeout(configChangeTimer);
      }
      configChangeTimer = setTimeout(() => {
        configChangeTimer = null;
        void (async () => {
          try {
            const text = (await fs.readFile(paths.configPath, "utf8")).replace(/^\uFEFF/, "");
            if (revisionFor(text) === lastKnownConfigRevision) {
              return;
            }

            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send("config:changed", { revision: revisionFor(text) });
            }
          } catch {
            // File may be mid-rename; the next watcher event retries.
          }
        })();
      }, 400);
    });
  } catch (error) {
    console.warn(`Failed to start config watcher: ${(error as Error).message || String(error)}`);
  }
}

function stopConfigWatcher() {
  if (configChangeTimer) {
    clearTimeout(configChangeTimer);
    configChangeTimer = null;
  }
  configWatcher?.close();
  configWatcher = null;
}

async function loadConfig() {
  const paths = getPaths();
  ensureConfigFile(paths);
  const { config, revision } = await readConfigStore(paths.configPath);
  lastKnownConfigRevision = revision;

  return {
    config,
    revision,
    paths,
    endpoint: getEndpoint(config),
    appName: APP_DISPLAY_NAME,
    appVersion: app.getVersion(),
    isDevelopmentRuntime,
  };
}

function getEndpoint(config: NormalizedConfig): string {
  return getChatCompletionsUrl(config);
}

function getVendorModelsUrl(vendor: { baseUrl?: string }): string {
  const baseUrl = String(vendor?.baseUrl || "").trim();
  if (!baseUrl) {
    throw new Error("Enter the vendor Base URL before refreshing models.");
  }

  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Vendor Base URL must use HTTP or HTTPS.");
  }

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchVendorModels(_event: IpcMainInvokeEvent, vendor: { baseUrl?: string; authentication?: string; apiKey?: string; apiKeyHeader?: string }): Promise<{ models: string[]; url: string }> {
  const url = getVendorModelsUrl(vendor);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const apiKey = vendor?.authentication === "api-key" ? String(vendor?.apiKey || "").trim() : "";
  const apiKeyHeader = vendor?.apiKeyHeader || "authorization";
  const authenticationHeader = apiKeyHeader === "authorization" ? `Bearer ${apiKey}` : apiKey;

  try {
    const response = await fetch(url, {
      headers: apiKey ? { [apiKeyHeader]: authenticationHeader } : {},
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    if (!response.ok) {
      const upstreamError = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "object"
        ? (body as { error: unknown }).error
        : body;
      const message = (upstreamError as { message?: string } | null | undefined)?.message || text || `HTTP ${response.status}`;
      const error = new Error(message) as Error & { code?: string; statusCode?: number };
      error.code = (upstreamError as { code?: string } | null | undefined)?.code || `HTTP_${response.status}`;
      error.statusCode = response.status;
      throw error;
    }

    const data = Array.isArray((body as { data?: unknown[] } | null)?.data) ? (body as { data: Array<{ id?: string }> }).data : [];
    const models = [...new Set(data.map((model) => String(model?.id || "").trim()).filter(Boolean))];
    if (!models.length) {
      throw new Error("The vendor did not return any models.");
    }

    return { models, url };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Refreshing models timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function hasUsableVendor(config: NormalizedConfig): boolean {
  return Array.isArray(config.vendors) && config.vendors.some(isUsableVendor);
}

function isUsableVendor(vendor: NormalizedConfig["vendors"][number]): boolean {
  if (!vendor || vendor.enabled === false) {
    return false;
  }

  if (!String(vendor.name || "").trim() || !String(vendor.baseUrl || "").trim()) {
    return false;
  }

  try {
    const url = new URL(String(vendor.baseUrl).trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
  } catch {
    return false;
  }

  const authentication = vendor.authentication === "api-key" || (!vendor.authentication && vendor.apiKey)
    ? "api-key"
    : "none";
  return authentication !== "api-key" || Boolean(vendor.apiKey);
}

async function saveConfig(_event: IpcMainInvokeEvent, payload: unknown) {
  const { paths } = await loadConfig();
  const config = (payload as { config?: unknown } | null)?.config || payload;
  const revision = (payload as { revision?: string } | null)?.revision || "";
  const saved = await writeConfigStore(paths.configPath, config as NormalizedConfig, revision);
  lastKnownConfigRevision = saved.revision;
  applyPackagedLoginStartup(saved.config.app.startAtLogin);
  const reload = await reloadManagedRouterAfterSave(paths);
  const vsCodeSync = await maybeSyncVsCodeModels(saved.config);
  return { ...saved, paths, endpoint: getEndpoint(saved.config), ...reload, vsCodeSync };
}

/**
 * Runs the VS Code model sync after a save when the user enabled it. Failures
 * are reported in the result but never fail the save itself.
 */
async function maybeSyncVsCodeModels(config: NormalizedConfig): Promise<VsCodeSyncResult | undefined> {
  if (config.app.syncVsCodeModels !== true) {
    return undefined;
  }
  return syncVsCodeModels(config);
}

async function syncVsCodeModelsNow(): Promise<VsCodeSyncResult> {
  const { config } = await loadConfig();
  return syncVsCodeModels(config);
}

async function reloadManagedRouterAfterSave(paths: Paths): Promise<RouterReloadResult> {
  const child = getRunningManagedRouterChild();
  if (child) {
    try {
      return await requestRouterConfigReload(child);
    } catch (error) {
      return {
        applied: false,
        restartRequired: true,
        restartFields: [],
        reloadError: (error as Error).message || String(error),
      };
    }
  }

  const metadata = await getManagedRouterMetadata(paths);
  if (metadata) {
    return {
      applied: false,
      restartRequired: true,
      restartFields: [],
      reloadError: "The running Router is not connected to this app instance. Restart it to apply the saved settings.",
    };
  }

  return { applied: false, restartRequired: false, restartFields: [], reloadError: "" };
}

function requestRouterConfigReload(child: ChildProcess, timeoutMs = 3000): Promise<RouterReloadResult> {
  const requestId = randomUUID();

  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      pendingRouterReloads.delete(requestId);
      rejectPromise(new Error("Router config reload timed out."));
    }, timeoutMs);
    pendingRouterReloads.set(requestId, {
      resolve: (message) => {
        clearTimeout(timeout);
        resolvePromise({
          applied: message.applied === true,
          restartRequired: message.restartRequired === true,
          restartFields: Array.isArray(message.restartFields) ? message.restartFields : [],
          reloadError: "",
        });
      },
      reject: (error) => {
        clearTimeout(timeout);
        rejectPromise(error);
      },
    });

    try {
      child.send({ type: "reload-config", requestId }, (error) => {
        if (!error) {
          return;
        }
        const pending = pendingRouterReloads.get(requestId);
        pendingRouterReloads.delete(requestId);
        pending?.reject(error);
      });
    } catch (error) {
      pendingRouterReloads.delete(requestId);
      clearTimeout(timeout);
      rejectPromise(error);
    }
  });
}

async function countRouterProcesses(paths: Paths = getPaths()): Promise<number> {
  return (await getManagedRouterMetadata(paths)) ? 1 : 0;
}

async function getManagedRouterMetadata(paths: Paths = getPaths()): Promise<ManagedRouterMetadata | null> {
  try {
    const metadata = JSON.parse(await fs.readFile(paths.pidPath, "utf8")) as Partial<ManagedRouterMetadata>;
    if (!Number.isInteger(metadata.pid) || (metadata.pid as number) <= 0 || !metadata.instanceId) {
      await removeRouterPid(paths);
      return null;
    }

    if (await isProcessRunning(metadata.pid as number)) {
      return metadata as ManagedRouterMetadata;
    }

    await removeRouterPid(paths);
    return null;
  } catch {
    await removeRouterPid(paths);
    return null;
  }
}

async function writeRouterPid(paths: Paths, metadata: ManagedRouterMetadata): Promise<void> {
  mkdirSync(dirname(paths.pidPath), { recursive: true });
  await fs.writeFile(paths.pidPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function removeRouterPid(paths: Paths = getPaths()): Promise<void> {
  await fs.rm(paths.pidPath, { force: true }).catch(() => null);
}

async function isProcessRunning(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function enqueueRouterLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = routerLifecycleQueue.then(operation, operation);
  routerLifecycleQueue = result.catch(() => null);
  return result;
}

function startRouter(): Promise<RouterActionResult> {
  return enqueueRouterLifecycle(startRouterInternal);
}

async function startRouterInternal(): Promise<RouterActionResult> {
  const { config, paths } = await loadConfig();

  if (!hasUsableVendor(config)) {
    const message = "No enabled vendor is configured. Add or enable a vendor before starting Router.";
    trayController.setConfigurationIssue(message);
    throw new Error(message);
  }

  const existingHealth = await getHealth(config, { includeProcessCount: true });
  if (existingHealth.ok || Number(existingHealth.processCount || 0) > 0) {
    await trayController.refreshStatus(existingHealth);
    return { started: false, via: "existing", health: existingHealth };
  }

  const processLog = await prepareProcessLog(paths);
  const processLogFd = openSync(processLog.path, "a");
  const instanceId = randomUUID();
  const managementToken = randomBytes(32).toString("base64url");
  let child: ChildProcess;
  try {
    child = spawn(paths.nodePath, [paths.serverPath], {
      cwd: paths.appDir,
      env: {
        ...process.env,
        ...(app.isPackaged && process.platform === "darwin" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        ROUTER_CONFIG: paths.configPath,
        HEIMDALL_DATA_DIR: paths.dataDir,
        HEIMDALL_INSTANCE_ID: instanceId,
        HEIMDALL_MANAGEMENT_TOKEN: managementToken,
      },
      stdio: ["ignore", processLogFd, processLogFd, "ipc"],
      windowsHide: true,
    });
    trackManagedRouterChild(child, paths, instanceId);
  } finally {
    closeSync(processLogFd);
  }

  try {
    await waitForChildSpawn(child);
  } catch (error) {
    const health = await getHealth(config);
    const message = `Router process could not start: ${(error as Error).message || String(error)}`;
    const failedHealth: HealthState = { ...health, ok: false, error: message, processLogPath: processLog.path };
    await recordRouterStartFailure(config, message, processLog.path);
    await trayController.refreshStatus(failedHealth);
    return { started: false, via: "process", health: failedHealth, error: message };
  }

  await writeRouterPid(paths, {
    pid: child.pid as number,
    instanceId,
    managementToken,
    configPath: paths.configPath,
    startedAt: new Date().toISOString(),
  });
  const health = await waitForHealth(config, { managementToken });
  if (!health.ok || health.body?.instanceId !== instanceId) {
    await stopManagedRouterChild(child);
    await removeRouterPid(paths);
    const output = await readProcessLogSince(processLog.path, processLog.offset);
    const detail = summarizeProcessOutput(output) || health.error || "Router process exited before becoming healthy.";
    const message = `Router failed to start: ${detail}`;
    const failedHealth: HealthState = { ...health, error: message, processLogPath: processLog.path };
    await recordRouterStartFailure(config, message, processLog.path);
    await trayController.refreshStatus(failedHealth);
    return {
      started: false,
      via: "process",
      pid: child.pid,
      health: failedHealth,
      error: message,
    };
  }
  await trayController.refreshStatus(health);
  return { started: true, via: "process", pid: child.pid, health };
}

function trackManagedRouterChild(child: ChildProcess, paths: Paths, instanceId: string) {
  managedRouterChild = child;

  child.on("message", (message: any) => {
    if (!message?.requestId || !["config-reloaded", "config-reload-failed"].includes(message.type)) {
      return;
    }
    const pending = pendingRouterReloads.get(message.requestId);
    if (!pending) {
      return;
    }
    pendingRouterReloads.delete(message.requestId);
    if (message.type === "config-reloaded") {
      pending.resolve(message);
    } else {
      pending.reject(new Error(message.error || "Router config reload failed."));
    }
  });

  const clearManagedChild = () => {
    if (managedRouterChild === child) {
      managedRouterChild = null;
    }
    for (const [requestId, pending] of pendingRouterReloads) {
      pendingRouterReloads.delete(requestId);
      pending.reject(new Error("Router exited before config reload completed."));
    }
    void removeRouterPidForInstance(paths, instanceId);
  };

  child.once("exit", clearManagedChild);
  child.once("error", () => {
    if (!child.pid) {
      clearManagedChild();
    }
  });
}

async function removeRouterPidForInstance(paths: Paths, instanceId: string): Promise<void> {
  try {
    const metadata = JSON.parse(await fs.readFile(paths.pidPath, "utf8")) as { instanceId?: string };
    if (metadata.instanceId === instanceId) {
      await removeRouterPid(paths);
    }
  } catch {
    // Stale or missing pid files are ignored.
  }
}

async function prepareProcessLog(paths: Paths): Promise<{ path: string; offset: number }> {
  const path = join(paths.dataDir, "logs", "router-process.log");
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.appendFile(path, `\n[${new Date().toISOString()}] Starting Router\n`, "utf8");
  const { size } = await fs.stat(path);
  return { path, offset: size };
}

async function readProcessLogSince(path: string, offset: number, maxBytes = 8192): Promise<string> {
  try {
    const handle = await fs.open(path, "r");
    try {
      const { size } = await handle.stat();
      const available = Math.max(0, size - offset);
      const length = Math.min(available, maxBytes);
      if (!length) {
        return "";
      }

      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString("utf8").trim();
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

function waitForChildSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("spawn", resolvePromise);
    child.once("error", rejectPromise);
  });
}

function summarizeProcessOutput(output: string): string {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /^Error(?:\s|\[|:)/.test(line)) || lines.at(-1) || "";
}

async function recordRouterStartFailure(config: NormalizedConfig, message: string, processLogPath: string): Promise<void> {
  try {
    const logPath = await getLogPath(config);
    await fs.mkdir(dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify({
      time: new Date().toISOString(),
      level: "error",
      event: "router_start_failed",
      errorMessage: message,
      processLogPath,
    })}\n`, "utf8");
  } catch {
    // The startup result still carries the error when diagnostic logging fails.
  }
}

function stopRouter(): Promise<RouterActionResult> {
  return enqueueRouterLifecycle(stopRouterInternal);
}

async function stopRouterInternal(): Promise<RouterActionResult> {
  const paths = getPaths();
  const child = getRunningManagedRouterChild();
  if (child) {
    await stopManagedRouterChild(child);
    await removeRouterPid(paths);

    const health = await getHealth();
    await trayController.refreshStatus(health);
    return { stopped: true, health };
  }

  const metadata = await getManagedRouterMetadata(paths);

  if (!metadata) {
    const health = await getHealth(null, { includeProcessCount: false });
    if (health.ok) {
      throw new Error("The running Router is not managed by this app instance and cannot be stopped safely.");
    }
    return { stopped: true, health };
  }

  const { config } = await loadConfig();
  const managedHealth = await getHealth(config, { includeProcessCount: false, managementToken: metadata.managementToken });
  if (managedHealth.body?.instanceId !== metadata.instanceId) {
    throw new Error("Refusing to stop a process whose Router instance identity could not be verified.");
  }
  await terminateProcess(metadata.pid);

  await removeRouterPid(paths);

  const health = await getHealth();
  await trayController.refreshStatus(health);
  return { stopped: true, health };
}

function getRunningManagedRouterChild(): ChildProcess | null {
  if (!managedRouterChild || managedRouterChild.exitCode !== null || managedRouterChild.signalCode !== null) {
    return null;
  }
  return managedRouterChild;
}

async function stopManagedRouterChild(child: ChildProcess, timeoutMs = 3000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (child.connected) {
    try {
      child.send({ type: "shutdown" }, () => {});
    } catch {
      // The process may already be gone.
    }
  }

  if (await waitForChildExit(child, timeoutMs)) {
    return;
  }

  child.kill("SIGKILL");
  if (!await waitForChildExit(child, timeoutMs)) {
    throw new Error("Router process did not exit after forced termination.");
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolvePromise) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolvePromise(true);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolvePromise(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function terminateProcess(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
    return;
  }

  await waitForProcessExit(pid);
  if (await isProcessRunning(pid)) {
    process.kill(pid, "SIGKILL");
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isProcessRunning(pid)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
}

function restartRouter(): Promise<RouterActionResult> {
  return enqueueRouterLifecycle(async () => {
    await stopRouterInternal();
    return startRouterInternal();
  });
}

async function waitForHealth(config: NormalizedConfig, options: HealthOptions = {}): Promise<HealthState> {
  for (let index = 0; index < 8; index += 1) {
    const health = await getHealth(config, { ...options, includeProcessCount: false });
    if (health.ok) {
      return health;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }

  return getHealth(config, options);
}

async function getHealth(configArg: NormalizedConfig | null = null, options: HealthOptions = {}): Promise<HealthState> {
  const includeProcessCount = options.includeProcessCount !== false;
  const loaded = configArg ? { config: configArg, paths: getPaths() } : await loadConfig();
  const url = `${getRouterBaseUrl(loaded.config)}/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  const headers: Record<string, string> = options.managementToken
    ? { "x-router-management-token": options.managementToken }
    : loaded.config.router.apiKey
      ? { authorization: `Bearer ${loaded.config.router.apiKey}` }
      : {};

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let body: HealthBody | null = null;
    try {
      body = JSON.parse(text) as HealthBody;
    } catch {
      body = null;
    }

    const processCount = !response.ok && includeProcessCount ? await countRouterProcesses(loaded.paths) : 0;
    return {
      ok: response.ok,
      status: response.status,
      url,
      body,
      text,
      processCount,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: (error as Error).name === "AbortError" ? "Health check timed out." : (error as Error).message,
      processCount: includeProcessCount ? await countRouterProcesses(loaded.paths) : 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getLogPath(configArg: NormalizedConfig | null = null): Promise<string> {
  const { config, paths } = configArg ? { config: configArg, paths: getPaths() } : await loadConfig();
  return resolveLogPath(config, paths.dataDir);
}

async function readLogs(_event: IpcMainInvokeEvent, options: { limit?: number; before?: number } = {}) {
  const { config } = await loadConfig();
  const logPath = await getLogPath(config);
  const limit = clampNumber(options.limit, 80, 20, 500);
  const before: number | null = Number.isInteger(options.before) ? (options.before as number) : null;

  if (!existsSync(logPath)) {
    return { path: logPath, lines: [], nextBefore: null, hasMore: false };
  }

  return readLogPage(logPath, { limit, before });
}

async function readUsage(_event: IpcMainInvokeEvent, options: { vendor?: string; model?: string } = {}) {
  const { paths } = await loadConfig();
  return readUsageSummary(paths.dataDir, {
    vendor: options.vendor,
    model: options.model,
  });
}

async function readPricingCache() {
  const { paths } = await loadConfig();
  return { ok: true, data: loadPricingCache(paths.dataDir) };
}

async function readModelInfoCache() {
  const { paths } = await loadConfig();
  return { ok: true, data: loadModelInfoCache(paths.dataDir) };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

// 打开本地文件/目录：shell.openPath 成功返回 ""、失败返回错误串。
// 这里只把结果归约为 { ok }，原始错误串不传给渲染层（渲染层弹固定友好提示）。
async function openPathResult(target: string): Promise<{ ok: boolean }> {
  try {
    return { ok: (await shell.openPath(target)) === "" };
  } catch {
    return { ok: false };
  }
}

async function openConfigFile(): Promise<{ ok: boolean }> {
  const { paths } = await loadConfig();
  return openPathResult(paths.configPath);
}

async function openLogFile(): Promise<{ ok: boolean }> {
  const logPath = await getLogPath();
  await ensureLogFile(logPath);
  return openPathResult(logPath);
}

async function openDataDir(): Promise<{ ok: boolean }> {
  return openPathResult(getPaths().dataDir);
}

async function getDataDirState() {
  const dataDir = getPaths().dataDir;
  return {
    dataDir,
    defaultDataDir: defaultUserDataDir,
    pointerPath: pointerFilePath(defaultUserDataDir),
    editable: app.isPackaged,
    // Computed here because the comparison is platform-aware (case-insensitive
    // on Windows only); the renderer must not re-implement it.
    isCustom: !sameDirectoryPath(dataDir, defaultUserDataDir),
    warning: dataDirFallbackWarning,
  };
}

async function pickDataDir(): Promise<{ canceled: boolean; path: string }> {
  const options: OpenDialogOptions = {
    title: "Choose where Heimdall stores its data",
    buttonLabel: "Choose this folder",
    defaultPath: getPaths().dataDir,
    properties: ["openDirectory", "createDirectory"],
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  return { canceled: result.canceled, path: result.filePaths[0] || "" };
}

async function changeDataDir(_event: IpcMainInvokeEvent, payload: { target?: string } = {}) {
  if (!app.isPackaged) {
    throw new Error("The data directory can only be changed in the installed app.");
  }

  const paths = getPaths();
  const check = validateDataDirTarget({
    target: String(payload?.target || ""),
    currentDataDir: paths.dataDir,
    defaultUserDataDir,
    installDir: dirname(process.execPath),
  });

  if (!check.ok) {
    throw new Error(check.error);
  }

  const backToDefault = sameDirectoryPath(check.path, defaultUserDataDir);

  if (sameDirectoryPath(check.path, paths.dataDir)) {
    return { ok: true, dataDir: check.path, files: 0, bytes: 0, skipped: 0, restartScheduled: false };
  }

  if (!ensureDataDirUsable(check.path)) {
    throw new Error(`Heimdall cannot write to ${check.path}. Choose another folder.`);
  }

  if (!backToDefault) {
    // The copy would overwrite whatever the target already holds, so refuse a
    // non-empty folder. Restoring the default folder is exempt: a config.json
    // there is the leftover of a fallback session, and overwriting it with the
    // real data set is exactly the recovery path.
    const conflicts = await listMigrationConflicts(paths.dataDir, check.path);
    if (conflicts.length > 0) {
      throw new Error(`${check.path} already contains ${conflicts.join(", ")}. Choose an empty folder.`);
    }
  }

  // Router holds config.json, the log file and the usage journal open, so it has
  // to release them before the files move.
  await stopRouter();
  let migration;
  try {
    migration = await migrateDataDirContents({ from: paths.dataDir, to: check.path });
  } catch (error) {
    // The migration failed and the old data directory is intact (a failed copy
    // verification never deletes the source). Bring the Router back up on the
    // old config so the app is not left degraded.
    await startRouter().catch(() => null);
    throw error;
  }

  // From here the data is committed to the new directory, so every remaining
  // step must still lead to the relaunch.
  await writeDataDirPointer(pointerFilePath(defaultUserDataDir), backToDefault ? null : check.path);
  dataDirFallbackWarning = "";

  // Re-point this session right away: getPaths() still reports the old folder
  // until the relaunch, and a late loadConfig() would seed a second config.json there.
  process.env.HEIMDALL_DATA_DIR = check.path;

  if (paths.configPath === join(paths.dataDir, "config.json")) {
    process.env.ROUTER_CONFIG = join(check.path, "config.json");
  }

  // A failed log-file relocation must not block the relaunch; the log path is
  // re-resolved on the next start.
  await relocateLogFileInsideDataDir(paths.dataDir).catch(() => null);
  scheduleDataDirRestart();

  return {
    ok: true,
    dataDir: check.path,
    files: migration.files,
    bytes: migration.bytes,
    skipped: migration.skipped.length,
    restartScheduled: true,
  };
}

/**
 * An absolute `router.logFile` inside the directory we just emptied would make
 * the Router write logs back into the abandoned location.
 */
async function relocateLogFileInsideDataDir(previousDataDir: string): Promise<void> {
  const paths = getPaths();
  const { config, revision } = await readConfigStore(paths.configPath);
  const logFile = config.router.logFile;

  if (isAbsolute(logFile) && isWithinDirectory(previousDataDir, logFile)) {
    const nextLogFile = normalize(join(paths.dataDir, relative(previousDataDir, logFile)));
    await writeConfigStore(paths.configPath, { ...config, router: { ...config.router, logFile: nextLogFile } }, revision);
  }
}

function scheduleDataDirRestart(): void {
  if (dataDirRestartScheduled) {
    return;
  }

  // userData and the Router environment are both fixed before the app is ready,
  // so the new location only takes effect on a full relaunch.
  dataDirRestartScheduled = true;
  trayController.setBusy("Restarting...");
  setTimeout(() => {
    app.relaunch();
    void quitApplication();
  }, 800);
}

async function getAppState() {
  const loaded = await loadConfig();
  return {
    ...loaded,
    health: await getHealth(loaded.config),
    appVersion: app.getVersion(),
  };
}

function hasHiddenStartArg(args: string[] = process.argv): boolean {
  return args.some((arg) => HIDDEN_START_ARGS.has(String(arg).toLowerCase())) || process.env.HEIMDALL_START_HIDDEN === "1";
}

function isBackgroundStartup(): boolean {
  if (hasHiddenStartArg()) {
    return true;
  }

  return app.isPackaged
    && process.platform === "darwin"
    && app.getLoginItemSettings().wasOpenedAtLogin === true;
}

async function installDownloadedUpdate(): Promise<UpdateState> {
  const updateState = getUpdateState();
  if (updateState.mock || updateState.status !== "downloaded") {
    return installUpdate();
  }

  isQuitting = true;
  trayController.setBusy("Installing update...");

  try {
    await stopRouter();
  } catch (error) {
    trayController.showNotification("Heimdall", `Failed to stop Router before update: ${(error as Error).message || String(error)}`);
    isQuitting = false;
    trayController.setBusy("");
    throw error;
  }

  let result: UpdateState;
  try {
    result = await installUpdate();
  } catch (error) {
    isQuitting = false;
    trayController.setBusy("");
    void recoverRouterAfterFailedUpdate();
    throw error;
  }

  // installUpdate() can also fail without throwing (e.g. the temp installer
  // was cleaned up). In that case the Router is already stopped, so restart it.
  if (result.status === "error") {
    isQuitting = false;
    trayController.setBusy("");
    void recoverRouterAfterFailedUpdate();
  }

  return result;
}

async function recoverRouterAfterFailedUpdate(): Promise<void> {
  try {
    const result = await startRouter();
    if (!result.health.ok) {
      trayController.showNotification("Heimdall", `Update install failed and Router did not recover: ${healthDetail(result.health)}`);
      return;
    }
    trayController.showNotification("Heimdall", "The update install failed, but the Router was restarted.");
  } catch (error) {
    trayController.showNotification("Heimdall", `Update install failed and Router could not be restarted: ${(error as Error).message || String(error)}`);
  }
}

function handleUpdateStateChanged() {
  trayController.updateMenu();
}

async function startRouterForBackgroundStartup(): Promise<void> {
  try {
    const { config } = await loadConfig();
    if (!hasUsableVendor(config)) {
      trayController.setConfigurationIssue("No enabled vendors configured.");
      return;
    }

    const result = await startRouter();
    if (!result.health?.ok) {
      trayController.showNotification("Heimdall startup issue", healthDetail(result.health));
    }
  } catch (error) {
    await trayController.refreshStatus().catch(() => null);
    trayController.showNotification("Heimdall failed to start", (error as Error).message || String(error));
  }
}

function sendOpenSettingsEvent() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("app:openSettings");
  }
}

function showSettingsWindow() {
  if (!app.isReady()) {
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ showWhenReady: true });
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  sendOpenSettingsEvent();
}

function requestWindowCloseConfirmation(window: BrowserWindow | null) {
  if (closePromptActive || !window || window.isDestroyed()) {
    return;
  }

  closePromptActive = true;

  if (window.webContents.isDestroyed()) {
    closePromptActive = false;
    window.hide();
    return;
  }

  window.webContents.send("app:confirmClose");
}

async function handleWindowClose(window: BrowserWindow | null): Promise<void> {
  try {
    const { config } = await loadConfig();
    const closeBehavior = config.app?.closeBehavior || DEFAULT_CONFIG.app.closeBehavior;

    if (closeBehavior === "exit") {
      await quitApplication();
      return;
    }

    if (closeBehavior === "ask") {
      requestWindowCloseConfirmation(window);
      return;
    }

    closePromptActive = false;
    if (window && !window.isDestroyed()) {
      window.hide();
    }
  } catch (error) {
    trayController.showNotification("Heimdall", `Failed to read close behavior: ${(error as Error).message || String(error)}`);
    requestWindowCloseConfirmation(window);
  }
}

async function quitApplication(): Promise<void> {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  trayController.setBusy("Stopping Router...");

  try {
    await stopRouter();
  } catch (error) {
    trayController.showNotification("Heimdall", `Failed to stop Router: ${(error as Error).message || String(error)}`);
  } finally {
    trayController.dispose();
    app.quit();
  }
}

function updateTitleBarOverlay() {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform === "darwin") return;
  const symbolColor = nativeTheme.shouldUseDarkColors ? "#94A3B8" : "#475569";
  mainWindow.setTitleBarOverlay({ color: "#00000000", symbolColor, height: 34 });
}

let shellTheme: "system" | "light" | "dark" = "system";

function applyShellTheme(theme: "system" | "light" | "dark") {
  shellTheme = theme;
  nativeTheme.themeSource = theme;
  updateTitleBarOverlay();
}

function createWindow({ showWhenReady = true }: { showWhenReady?: boolean } = {}): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (showWhenReady) {
      showSettingsWindow();
    }
    return mainWindow;
  }

  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    show: false,
    width: 1240,
    height: 820,
    minWidth: 1040,
    minHeight: 700,
    icon: createAppIcon() || undefined,
    backgroundColor: "#00000000",
    title: APP_DISPLAY_NAME,
    // 无边框窗口：macOS 用红绿灯 + under-window 毛玻璃，
    // Windows 用 titleBarOverlay 接管右上角控制按钮 + mica 云母材质
    titleBarStyle: "hidden",
    ...(isMac
      ? {
          trafficLightPosition: { x: 18, y: 16 },
          vibrancy: "under-window",
          visualEffectState: "active",
        }
      : {
          backgroundMaterial: "mica",
          titleBarOverlay: {
            color: "#00000000",
            symbolColor: nativeTheme.shouldUseDarkColors ? "#94A3B8" : "#475569",
            // 与 .electron-shell .app-shell 的 34px 顶部拖拽条对齐
            height: 34,
          },
        }),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);

  if (showWhenReady) {
    windowsToShowOnReady.add(mainWindow);
  }

  const showFallback = showWhenReady ? setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 4000) : null;
  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    void handleWindowClose(mainWindow);
  });
  mainWindow.once("closed", () => {
    if (showFallback) {
      clearTimeout(showFallback);
    }
    windowsToShowOnReady.delete(mainWindow as BrowserWindow);
    mainWindow = null;
  });

  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // 首帧主题注入：把可靠的 shellTheme 与系统深色状态传给渲染进程，
  // 规避首启"跟随系统"时渲染进程 matchMedia 尚未同步 OS 偏好的竞态。
  const osDark = String(nativeTheme.shouldUseDarkColors);
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    const url = new URL(validateRendererUrl(rendererUrl));
    url.searchParams.set("theme", shellTheme);
    url.searchParams.set("osDark", osDark);
    mainWindow.loadURL(url.toString());
  } else {
    mainWindow.loadFile(join(__dirname, "..", "dist", "index.html"), {
      query: { theme: shellTheme, osDark },
    });
  }

  return mainWindow;
}

function validateRendererUrl(value: string): string {
  if (app.isPackaged) {
    throw new Error("ELECTRON_RENDERER_URL is only allowed in development.");
  }

  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("ELECTRON_RENDERER_URL must point to a localhost development server.");
  }

  return url.toString();
}

function applyPackagedLoginStartup(enabled: boolean) {
  if (!app.isPackaged || !["darwin", "win32"].includes(process.platform)) {
    return;
  }

  if (process.platform === "win32") {
    app.setLoginItemSettings({
      openAtLogin: enabled === true,
      path: process.execPath,
      args: ["--hidden"],
    });
    return;
  }

  app.setLoginItemSettings({ openAtLogin: enabled === true, openAsHidden: true });
}

function registerIpcHandler(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown | Promise<unknown>,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      throw new Error(`Rejected IPC request from an untrusted sender: ${channel}`);
    }
    const parsedArgs = parseIpcRequest(channel, args) as unknown[];
    try {
      const response = await handler(event, ...parsedArgs);
      return parseIpcResponse(channel, response);
    } catch (error) {
      console.error(`[IPC ${channel}] handler failed:`, error);
      throw error;
    }
  });
}

const trayController = createTrayController({
  createAppIcon: createTrayIcon,
  downloadUpdate,
  getHealth,
  getUpdateState,
  installUpdate: installDownloadedUpdate,
  isQuitting: () => isQuitting,
  openLogFile,
  quitApplication,
  restartRouter,
  showSettingsWindow,
  startRouter,
  stopRouter,
});

configureRuntimeIdentity();
app.setAppUserModelId(APP_USER_MODEL_ID);

registerIpcHandler("app:getState", getAppState);
registerIpcHandler("app:rendererReady", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window && !window.isDestroyed() && windowsToShowOnReady.has(window) && !window.isVisible()) {
    window.show();
    windowsToShowOnReady.delete(window);
  }
  return { ok: true };
});
registerIpcHandler("app:setTheme", (_event, theme) => {
  applyShellTheme(theme as "system" | "light" | "dark");
  return { ok: true };
});
// 订阅握手：渲染进程注册 onOsDarkChange 后回放当前 OS 深色状态，
// 覆盖 createWindow 快照与监听器注册之间 OS 切换导致推送丢失的窗口期。
registerIpcHandler("app:osDark", () => {
  return { osDark: nativeTheme.shouldUseDarkColors };
});
registerIpcHandler("app:hideToTray", () => {
  closePromptActive = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  return { ok: true };
});
registerIpcHandler("app:cancelClose", () => {
  closePromptActive = false;
  return { ok: true };
});
registerIpcHandler("app:quitAndStop", async () => {
  closePromptActive = false;
  await quitApplication();
  return { ok: true };
});
registerIpcHandler("config:load", loadConfig);
registerIpcHandler("config:save", saveConfig);
registerIpcHandler("vendor:listModels", fetchVendorModels);
registerIpcHandler("router:start", startRouter);
registerIpcHandler("router:stop", stopRouter);
registerIpcHandler("router:restart", restartRouter);
registerIpcHandler("router:health", (_event, options) => getHealth(null, options));
registerIpcHandler("logs:read", readLogs);
registerIpcHandler("usage:summary", readUsage);
registerIpcHandler("pricing:loadCache", readPricingCache);
registerIpcHandler("model-info:loadCache", readModelInfoCache);
registerIpcHandler("file:openConfig", openConfigFile);
registerIpcHandler("file:openLog", openLogFile);
registerIpcHandler("dataDir:getState", getDataDirState);
registerIpcHandler("dataDir:pick", pickDataDir);
registerIpcHandler("dataDir:change", changeDataDir);
registerIpcHandler("dataDir:open", openDataDir);
registerIpcHandler("update:getState", getUpdateState);
registerIpcHandler("update:check", (_event, options) => checkForUpdates(options));
registerIpcHandler("update:download", downloadUpdate);
registerIpcHandler("update:install", installDownloadedUpdate);
registerIpcHandler("update:openReleasePage", openReleasePage);
registerIpcHandler("repo:openRepo", async () => {
  try {
    await shell.openExternal(REPO_URL);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});
registerIpcHandler("clipboard:writeText", (_event, text) => {
  clipboard.writeText(String(text || ""));
  return { ok: true };
});
registerIpcHandler("vscode:sync", syncVsCodeModelsNow);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    if (hasHiddenStartArg(commandLine)) {
      void startRouterForBackgroundStartup();
      return;
    }

    showSettingsWindow();
  });

  app.whenReady().then(async () => {
    // OS 主题变化时：刷新标题栏符号色（跟随系统模式下 nativeTheme 仍为 system，
    // 不会触发 applyShellTheme），并权威推送给渲染进程刷新 knownOsDark。
    // 注册在 loadConfig 之前：配置损坏导致 catch 跳过后续代码时监听器仍生效。
    nativeTheme.on("updated", () => {
      updateTitleBarOverlay();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("app:osDark", nativeTheme.shouldUseDarkColors);
      }
    });
    try {
      const { config } = await loadConfig();
      applyPackagedLoginStartup(config.app.startAtLogin);
      applyShellTheme(config.app.theme);
    } catch (error) {
      trayController.showNotification("Heimdall", `Failed to load startup settings: ${(error as Error).message || String(error)}`);
    }
    if (dataDirFallbackWarning) {
      trayController.showNotification("Heimdall", dataDirFallbackWarning);
    }

    startConfigWatcher();
    initializeUpdater();
    onUpdateState(handleUpdateStateChanged);
    trayController.create();
    await trayController.refreshStatus().catch(() => null);
    void checkForUpdates().catch(() => null);

    if (isBackgroundStartup()) {
      void startRouterForBackgroundStartup();
    } else {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    isQuitting = true;
    stopConfigWatcher();
    trayController.dispose();
  });

  app.on("activate", () => {
    showSettingsWindow();
  });
}
