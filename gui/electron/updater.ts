import electron from "electron";
import electronUpdater from "electron-updater";
import type { UpdateDownloadedEvent } from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { updateStateSchema } from "./ipc-contracts.ts";
import { z } from "zod";

const { app, BrowserWindow, shell } = electron;
const RELEASES_URL = "https://github.com/landfallbox/heimdall/releases/latest";
const mockUpdateMode = String(process.env.HEIMDALL_MOCK_UPDATE || "").trim().toLowerCase();
const isMockUpdateEnabled = Boolean(!app?.isPackaged && mockUpdateMode);
const isRealUpdaterSupported = Boolean(app?.isPackaged && ["darwin", "win32"].includes(process.platform));
const isUpdaterSupported = isRealUpdaterSupported || isMockUpdateEnabled;
const mockUpdateVersion = String(process.env.HEIMDALL_MOCK_UPDATE_VERSION || "0.3.0-dev-preview").trim();

type UpdateState = z.infer<typeof updateStateSchema>;
type UpdateStatePatch = Partial<UpdateState>;
type AutoUpdater = typeof electronUpdater.autoUpdater;

let updateState: UpdateState = createInitialState();
let initialized = false;
let checkingPromise: Promise<UpdateState> | null = null;
let downloadPromise: Promise<UpdateState> | null = null;
let updater: AutoUpdater | null = null;
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

function normalizeUpdateInfo(info: UpdateInfo = {} as UpdateInfo): Pick<UpdateState, "availableVersion" | "releaseName" | "releaseNotes"> {
  return {
    availableVersion: String(info.version || ""),
    releaseName: String(info.releaseName || ""),
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
  };
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
  if (!isRealUpdaterSupported) {
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

  if (!updateState.availableVersion) {
    await checkForUpdates({ manual: true });
    if (!updateState.availableVersion) {
      return updateState;
    }
  }

  if (downloadPromise) {
    return downloadPromise;
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

export function installUpdate(): UpdateState {
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

  getAutoUpdater().quitAndInstall(false, true);
  return updateState;
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
