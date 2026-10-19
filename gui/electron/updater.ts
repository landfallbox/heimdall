import electron from "electron";
import electronUpdater from "electron-updater";
import type { UpdateDownloadedEvent } from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";
import { updateStateSchema } from "./ipc-contracts.ts";
import { z } from "zod";

const { app, BrowserWindow, shell } = electron;
const GITHUB_REPO = "landfallbox/heimdall";
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const WINDOWS_INSTALLER_PREFIX = "heimdall-Setup-";
const CHECK_TIMEOUT_MS = 15000;
const PROGRESS_EMIT_INTERVAL_MS = 250;
// Abort the download when no data arrives for this long (stalled network).
const DOWNLOAD_IDLE_TIMEOUT_MS = 30000;

const mockUpdateMode = String(process.env.HEIMDALL_MOCK_UPDATE || "").trim().toLowerCase();
const isMockUpdateEnabled = Boolean(!app?.isPackaged && mockUpdateMode);
const isWindowsUpdaterSupported = Boolean(app?.isPackaged && process.platform === "win32");
const isMacUpdaterSupported = Boolean(app?.isPackaged && process.platform === "darwin");
const isRealUpdaterSupported = isWindowsUpdaterSupported || isMacUpdaterSupported;
const isUpdaterSupported = isRealUpdaterSupported || isMockUpdateEnabled;
const mockUpdateVersion = String(process.env.HEIMDALL_MOCK_UPDATE_VERSION || "0.3.0-dev-preview").trim();

type UpdateState = z.infer<typeof updateStateSchema>;
type UpdateStatePatch = Partial<UpdateState>;
type AutoUpdater = typeof electronUpdater.autoUpdater;

interface PendingRelease {
  version: string;
  releaseName: string;
  releaseNotes: string;
  assetUrl: string;
}

let updateState: UpdateState = createInitialState();
let initialized = false;
let checkingPromise: Promise<UpdateState> | null = null;
let downloadPromise: Promise<UpdateState> | null = null;
let updater: AutoUpdater | null = null;
let pendingRelease: PendingRelease | null = null;
let windowsInstallerPath = "";
const stateListeners = new Set<(state: UpdateState) => void>();

function getAutoUpdater(): AutoUpdater {
  if (!updater) {
    updater = electronUpdater.autoUpdater;
  }

  return updater;
}

function getCurrentVersion(): string {
  return typeof app?.getVersion === "function" ? app.getVersion() : "";
}

function createInitialState(): UpdateState {
  return {
    status: isUpdaterSupported ? "idle" : "unsupported",
    supported: isUpdaterSupported,
    mock: isMockUpdateEnabled,
    currentVersion: getCurrentVersion(),
    availableVersion: "",
    releaseName: "",
    releaseNotes: "",
    progress: null,
    error: "",
    lastCheckedAt: "",
  };
}

function stripVersionPrefix(value: string): string {
  return value.trim().replace(/^[vV]/, "");
}

// Returns the numeric major/minor/patch parts, or null when the value is not
// a plain x.y.z version (pre-release tags are ignored, matching
// autoUpdater.allowPrerelease = false).
function parseReleaseVersion(value: string): number[] | null {
  const cleaned = stripVersionPrefix(value);
  if (!cleaned || /[-+]/.test(cleaned)) {
    return null;
  }

  const parts = cleaned.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }

  return parts;
}

function isVersionNewer(candidate: string, current: string): boolean {
  const candidateParts = parseReleaseVersion(candidate);
  const currentParts = parseReleaseVersion(current);
  if (!candidateParts || !currentParts) {
    return false;
  }

  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }

  return false;
}

function normalizeReleaseNotes(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item: { note?: unknown; version?: unknown }) => String(item?.note || item?.version || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  return String(value || "").trim();
}

function normalizeProgress(info: Partial<ProgressInfo> = {}) {
  return {
    percent: Number.isFinite(info.percent) ? Math.max(0, Math.min(100, info.percent as number)) : 0,
    bytesPerSecond: Number.isFinite(info.bytesPerSecond) ? (info.bytesPerSecond as number) : 0,
    transferred: Number.isFinite(info.transferred) ? (info.transferred as number) : 0,
    total: Number.isFinite(info.total) ? (info.total as number) : 0,
  };
}

function update(nextState: UpdateStatePatch): UpdateState {
  updateState = {
    ...updateState,
    ...nextState,
    supported: isUpdaterSupported,
    mock: isMockUpdateEnabled,
    currentVersion: getCurrentVersion(),
  };
  broadcastUpdateState();
  return updateState;
}

function broadcastUpdateState() {
  const validatedState = updateStateSchema.parse(updateState);
  if (typeof BrowserWindow?.getAllWindows === "function") {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send("update:state", validatedState);
      }
    }
  }

  for (const listener of stateListeners) {
    listener(validatedState);
  }
}

export function onUpdateState(listener: (state: UpdateState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function initializeUpdater(): UpdateState {
  if (initialized) {
    return updateState;
  }

  initialized = true;
  if (!isMacUpdaterSupported) {
    return updateState;
  }

  const autoUpdater = getAutoUpdater();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => {
    update({ status: "checking", error: "", progress: null });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    update({
      status: "available",
      ...normalizeUpdateInfo(info),
      progress: null,
      error: "",
      lastCheckedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    update({
      status: "not-available",
      ...normalizeUpdateInfo(info),
      availableVersion: "",
      progress: null,
      error: "",
      lastCheckedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on("download-progress", (info: ProgressInfo) => {
    update({ status: "downloading", progress: normalizeProgress(info), error: "" });
  });

  autoUpdater.on("update-downloaded", (event: UpdateDownloadedEvent) => {
    update({
      status: "downloaded",
      ...normalizeUpdateInfo(event),
      progress: normalizeProgress({ percent: 100, transferred: event?.downloadedFile ? 1 : 0, total: event?.downloadedFile ? 1 : 0 }),
      error: "",
    });
  });

  autoUpdater.on("error", (error: Error) => {
    update({
      status: "error",
      error: error?.message || String(error),
      progress: null,
    });
  });

  return updateState;
}

function normalizeUpdateInfo(info: UpdateInfo = {} as UpdateInfo): Pick<UpdateState, "availableVersion" | "releaseName" | "releaseNotes"> {
  return {
    availableVersion: String(info.version || ""),
    releaseName: String(info.releaseName || ""),
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
  };
}

export function getUpdateState(): UpdateState {
  return updateState;
}

export async function checkForUpdates({ manual = false }: { manual?: boolean } = {}): Promise<UpdateState> {
  initializeUpdater();

  if (isMockUpdateEnabled) {
    return checkForMockUpdate();
  }

  if (!isUpdaterSupported) {
    return update({
      status: "unsupported",
      error: manual ? "Updates are available only in supported packaged builds." : "",
      progress: null,
    });
  }

  if (isMacUpdaterSupported) {
    return checkForMacUpdates();
  }

  if (checkingPromise) {
    return checkingPromise;
  }

  checkingPromise = checkForWindowsUpdates()
    .catch((error: unknown) => {
      update({
        status: "error",
        error: (error as Error)?.message || String(error),
        progress: null,
      });
      if (manual) {
        throw error;
      }
      return updateState;
    })
    .finally(() => {
      checkingPromise = null;
    });

  return checkingPromise;
}

async function checkForMacUpdates(): Promise<UpdateState> {
  if (checkingPromise) {
    return checkingPromise;
  }

  checkingPromise = getAutoUpdater().checkForUpdates()
    .then(() => updateState)
    .catch((error: unknown) => {
      update({
        status: "error",
        error: (error as Error)?.message || String(error),
        progress: null,
      });
      return updateState;
    })
    .finally(() => {
      checkingPromise = null;
    });

  return checkingPromise;
}

async function checkForWindowsUpdates(): Promise<UpdateState> {
  update({ status: "checking", error: "", progress: null });

  const release = await fetchLatestRelease();
  const version = stripVersionPrefix(String(release.tag_name || ""));
  const currentVersion = getCurrentVersion();

  if (!isVersionNewer(version, currentVersion)) {
    pendingRelease = null;
    return update({
      status: "not-available",
      availableVersion: "",
      releaseName: "",
      releaseNotes: "",
      progress: null,
      error: "",
      lastCheckedAt: new Date().toISOString(),
    });
  }

  const asset = (Array.isArray(release.assets) ? release.assets : []).find(
    (candidate: { name?: unknown } | null) =>
      typeof candidate?.name === "string" &&
      candidate.name.startsWith(WINDOWS_INSTALLER_PREFIX) &&
      candidate.name.endsWith(".exe"),
  );
  if (!asset || typeof (asset as { browser_download_url?: unknown }).browser_download_url !== "string") {
    throw new Error(`The latest release does not include a ${WINDOWS_INSTALLER_PREFIX}<version>.exe asset.`);
  }

  pendingRelease = {
    version,
    releaseName: String(release.name || release.tag_name || `Heimdall ${version}`),
    releaseNotes: normalizeReleaseNotes(release.body),
    assetUrl: String((asset as { browser_download_url: string }).browser_download_url),
  };

  return update({
    status: "available",
    availableVersion: version,
    releaseName: pendingRelease.releaseName,
    releaseNotes: pendingRelease.releaseNotes,
    progress: null,
    error: "",
    lastCheckedAt: new Date().toISOString(),
  });
}

async function fetchLatestRelease(): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Heimdall-Updater",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch the latest release (HTTP ${response.status}).`);
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timed out while fetching the latest release.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadUpdate(): Promise<UpdateState> {
  initializeUpdater();

  if (isMockUpdateEnabled) {
    return downloadMockUpdate();
  }

  if (!isUpdaterSupported) {
    return update({
      status: "unsupported",
      error: "Updates are available only in supported packaged builds.",
      progress: null,
    });
  }

  if (updateState.status === "downloaded") {
    return updateState;
  }

  if (isMacUpdaterSupported) {
    return downloadMacUpdate();
  }

  if (!pendingRelease) {
    await checkForUpdates({ manual: true });
  }
  if (!pendingRelease) {
    return updateState;
  }

  if (downloadPromise) {
    return downloadPromise;
  }

  const release = pendingRelease;
  update({ status: "downloading", error: "", progress: normalizeProgress() });
  downloadPromise = downloadWindowsInstaller(release)
    .then(() => updateState)
    .catch((error: unknown) => {
      update({
        status: "error",
        error: (error as Error)?.message || String(error),
        progress: null,
      });
      throw error;
    })
    .finally(() => {
      downloadPromise = null;
    });

  return downloadPromise;
}

async function downloadMacUpdate(): Promise<UpdateState> {
  if (downloadPromise) {
    return downloadPromise;
  }

  if (!updateState.availableVersion) {
    await checkForUpdates({ manual: true });
    if (!updateState.availableVersion) {
      return updateState;
    }
  }

  update({ status: "downloading", error: "", progress: normalizeProgress() });
  downloadPromise = getAutoUpdater().downloadUpdate()
    .then(() => updateState)
    .catch((error: unknown) => {
      update({
        status: "error",
        error: (error as Error)?.message || String(error),
        progress: null,
      });
      throw error;
    })
    .finally(() => {
      downloadPromise = null;
    });

  return downloadPromise;
}

async function downloadWindowsInstaller(release: PendingRelease): Promise<void> {
  const assetName = `${WINDOWS_INSTALLER_PREFIX}${release.version}.exe`;
  const destination = join(app.getPath("temp"), assetName);

  // Abort the download when no data arrives for DOWNLOAD_IDLE_TIMEOUT_MS.
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdleTimeout = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  const clearIdleTimeout = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  let response: Response;
  try {
    armIdleTimeout();
    response = await fetch(release.assetUrl, {
      headers: { "User-Agent": "Heimdall-Updater" },
      signal: controller.signal,
    });
  } catch (error) {
    clearIdleTimeout();
    throw toDownloadError(error, controller.signal.aborted);
  }
  if (!response.ok || !response.body) {
    clearIdleTimeout();
    throw new Error(`Failed to download the update (HTTP ${response.status}).`);
  }

  const total = Number(response.headers.get("content-length") || 0);
  const startedAt = Date.now();
  let transferred = 0;
  let lastEmitAt = 0;

  const fileStream = createWriteStream(destination);
  let streamError: Error | null = null;
  fileStream.on("error", (error: Error) => {
    streamError = error;
    controller.abort();
  });
  try {
    const reader = response.body.getReader();
    for (;;) {
      armIdleTimeout();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (streamError) {
          throw streamError;
        }
        throw toDownloadError(error, controller.signal.aborted);
      } finally {
        clearIdleTimeout();
      }
      if (chunk.done) {
        break;
      }

      if (!fileStream.write(chunk.value)) {
        // Respect backpressure so a slow disk cannot balloon memory usage.
        await new Promise<void>((resolveDrain, rejectDrain) => {
          if (streamError) {
            rejectDrain(streamError);
            return;
          }
          const onDrain = () => {
            fileStream.off("error", onError);
            resolveDrain();
          };
          const onError = (error: Error) => {
            fileStream.off("drain", onDrain);
            rejectDrain(error);
          };
          fileStream.once("drain", onDrain);
          fileStream.once("error", onError);
        });
      }
      if (streamError) {
        throw streamError;
      }
      transferred += chunk.value.byteLength;

      const now = Date.now();
      if (now - lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS) {
        lastEmitAt = now;
        emitDownloadProgress(transferred, total, startedAt);
      }
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      fileStream.end((error: Error | null) => (error ? rejectPromise(error) : resolvePromise()));
    });
  } catch (error) {
    fileStream.destroy();
    throw error;
  } finally {
    clearIdleTimeout();
  }

  if (streamError) {
    throw streamError;
  }
  // A stream that ended early (e.g. the server dropped the connection) would
  // otherwise be treated as a complete download and installed as a broken exe.
  if (total > 0 && transferred !== total) {
    throw new Error(`Downloaded update is incomplete (${transferred} of ${total} bytes). Download it again.`);
  }

  windowsInstallerPath = destination;
  emitDownloadProgress(transferred, total, startedAt);
  update({
    status: "downloaded",
    progress: {
      percent: 100,
      bytesPerSecond: 0,
      transferred,
      total: total > 0 ? total : transferred,
    },
    error: "",
  });
}

function toDownloadError(error: unknown, aborted: boolean): Error {
  if (aborted && error instanceof Error && error.name === "AbortError") {
    return new Error("The update download stalled and was cancelled. Check your network and try again.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

function emitDownloadProgress(transferred: number, total: number, startedAt: number) {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  update({
    status: "downloading",
    progress: {
      percent: total > 0 ? Math.max(0, Math.min(100, Math.round((transferred / total) * 100))) : 0,
      bytesPerSecond: Math.round(transferred / elapsedSeconds),
      transferred,
      total,
    },
    error: "",
  });
}

export async function installUpdate(): Promise<UpdateState> {
  initializeUpdater();

  if (isMockUpdateEnabled) {
    if (updateState.status !== "downloaded") {
      return update({ status: "error", error: "Download the mock update before installing it.", progress: null });
    }

    return update({ status: "installed", error: "", progress: null });
  }

  if (!isUpdaterSupported) {
    return update({
      status: "unsupported",
      error: "Updates are available only in supported packaged builds.",
      progress: null,
    });
  }

  if (updateState.status !== "downloaded") {
    return update({
      status: "error",
      error: "Download the update before installing it.",
      progress: null,
    });
  }

  if (isMacUpdaterSupported) {
    getAutoUpdater().quitAndInstall(false, true);
    return updateState;
  }

  // The temp file may have been cleaned up since the download, so a non-empty
  // path is not enough — spawning a missing exe would ENOENT and leave the
  // app with the Router stopped.
  if (!windowsInstallerPath || !existsSync(windowsInstallerPath)) {
    return update({
      status: "error",
      error: "The downloaded installer is missing. Download the update again.",
      progress: null,
    });
  }

  // The installer is per-user (no elevation) and closes the running app
  // itself (CloseApplications=yes + /CLOSEAPPLICATIONS). Wait for the process
  // to actually start before marking the update installed and quitting:
  // launch failures (antivirus/SmartScreen EACCES, a cleaned-up temp file)
  // arrive asynchronously through the "error" event, and quitting on top of
  // them would lose the app and the Router without installing anything.
  return new Promise<UpdateState>((resolveInstall) => {
    const childProcess = spawn(
      windowsInstallerPath,
      ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/CLOSEAPPLICATIONS", "/NORESTART"],
      { detached: true, stdio: "ignore" },
    );
    childProcess.once("error", (error: Error) => {
      resolveInstall(
        update({ status: "error", error: `Failed to start the installer: ${error.message}`, progress: null }),
      );
    });
    childProcess.once("spawn", () => {
      childProcess.unref();
      resolveInstall(update({ status: "installed", error: "", progress: null }));
      // Quit shortly after so the IPC response is delivered and the app
      // releases its files first.
      setTimeout(() => {
        app.quit();
      }, 500);
    });
  });
}

async function checkForMockUpdate(): Promise<UpdateState> {
  update({ status: "checking", error: "", progress: null });
  await delay(350);

  if (mockUpdateMode === "error") {
    return update({
      status: "error",
      availableVersion: "",
      error: "Mock update check failed.",
      lastCheckedAt: new Date().toISOString(),
    });
  }

  if (["none", "not-available", "up-to-date"].includes(mockUpdateMode)) {
    return update({
      status: "not-available",
      availableVersion: "",
      releaseName: "",
      releaseNotes: "",
      error: "",
      lastCheckedAt: new Date().toISOString(),
    });
  }

  const status = mockUpdateMode === "downloaded" ? "downloaded" : "available";
  return update({
    status,
    availableVersion: mockUpdateVersion,
    releaseName: `Heimdall ${mockUpdateVersion}`,
    releaseNotes: "Development-only update preview.",
    progress: status === "downloaded" ? normalizeProgress({ percent: 100, transferred: 104857600, total: 104857600 }) : null,
    error: "",
    lastCheckedAt: new Date().toISOString(),
  });
}

async function downloadMockUpdate(): Promise<UpdateState> {
  if (downloadPromise) {
    return downloadPromise;
  }

  if (!updateState.availableVersion) {
    await checkForMockUpdate();
  }
  if (!["available", "error"].includes(updateState.status)) {
    return updateState;
  }

  const total = 104857600;
  downloadPromise = (async () => {
    for (const percent of [8, 24, 47, 73, 91, 100]) {
      if (mockUpdateMode === "download-error" && percent === 73) {
        return update({
          status: "error",
          progress: null,
          error: "Mock update download failed.",
        });
      }

      update({
        status: percent === 100 ? "downloaded" : "downloading",
        progress: normalizeProgress({
          percent,
          bytesPerSecond: 12582912,
          transferred: Math.round(total * percent / 100),
          total,
        }),
        error: "",
      });
      await delay(percent === 100 ? 0 : 280);
    }
    return updateState;
  })().finally(() => {
    downloadPromise = null;
  });

  return downloadPromise;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function openReleasePage(): Promise<{ ok: boolean }> {
  if (typeof shell?.openExternal !== "function") {
    return { ok: false };
  }

  await shell.openExternal(RELEASES_URL);
  return { ok: true };
}
