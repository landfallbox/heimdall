import type { RemoteModelInfoData } from "../../src/model-info.ts";
import type { RemotePricingData } from "../../src/usage.ts";
import type { ThemeMode } from "./config-draft.ts";
import type { HealthState, LogPage, UpdateState, UsageSummary } from "./types.ts";

export interface AppState {
  appName: string;
  appVersion: string;
  isDevelopmentRuntime: boolean;
  config: unknown;
  revision: string;
}

export interface VsCodeSyncResult {
  ok: boolean;
  filePath: string;
  modelCount: number;
  createdProvider: boolean;
  error?: string;
}

export interface SaveConfigResult {
  config: unknown;
  revision: string;
  applied?: boolean;
  restartRequired?: boolean;
  restartFields?: string[];
  reloadError?: string;
  vsCodeSync?: VsCodeSyncResult;
}

export interface RouterActionResult {
  health: HealthState;
  error?: string;
}

export interface VendorModelListResult {
  models: string[];
}

export interface PricingCacheResult {
  ok: boolean;
  data: RemotePricingData | null;
}

export interface ModelInfoCacheResult {
  ok: boolean;
  data: RemoteModelInfoData | null;
}

export interface DataDirState {
  dataDir: string;
  defaultDataDir: string;
  pointerPath: string;
  editable: boolean;
  isCustom: boolean;
  warning: string;
}

export interface DataDirChangeResult {
  ok: boolean;
  dataDir: string;
  files: number;
  bytes: number;
  skipped: number;
  restartScheduled: boolean;
}

export interface HeimdallDesktopApi {
  getState(): Promise<AppState>;
  rendererReady(): Promise<void>;
  setTheme(theme: ThemeMode): Promise<{ ok: boolean }>;
  hideToTray(): Promise<void>;
  cancelClose(): Promise<void>;
  quitAndStop(): Promise<void>;
  loadConfig(): Promise<AppState>;
  saveConfig(payload: { config: unknown; revision?: string }): Promise<SaveConfigResult>;
  listVendorModels(vendor: unknown): Promise<VendorModelListResult>;
  startRouter(): Promise<RouterActionResult>;
  stopRouter(): Promise<RouterActionResult>;
  restartRouter(): Promise<RouterActionResult>;
  checkHealth(options?: { includeProcessCount?: boolean }): Promise<HealthState>;
  readLogs(options?: { limit?: number; before?: number | null }): Promise<LogPage>;
  readUsageSummary(options?: { vendor?: string; model?: string }): Promise<UsageSummary>;
  loadPricingCache(): Promise<PricingCacheResult>;
  loadModelInfoCache(): Promise<ModelInfoCacheResult>;
  openConfig(): Promise<void>;
  openLog(): Promise<void>;
  getDataDirState(): Promise<DataDirState>;
  pickDataDir(): Promise<{ canceled: boolean; path: string }>;
  changeDataDir(target: string): Promise<DataDirChangeResult>;
  openDataDir(): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(options?: { manual?: boolean }): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  openReleasePage(): Promise<void>;
  writeClipboard(text: string): Promise<void>;
  syncVsCodeModels(): Promise<VsCodeSyncResult>;
  onOpenSettings(callback: () => void): (() => void) | undefined;
  onConfirmClose(callback: () => void): (() => void) | undefined;
  onUpdateState(callback: (state: UpdateState) => void): (() => void) | undefined;
  /** 配置文件在应用外部被修改时触发（主进程文件监听）。 */
  onConfigChanged(callback: (payload: { revision: string }) => void): (() => void) | undefined;
}

declare global {
  interface Window {
    heimdall?: HeimdallDesktopApi;
  }
}

export function getDesktopApi(): HeimdallDesktopApi {
  if (!window.heimdall) {
    throw new Error("Desktop API is unavailable. Close this window and reopen the app with npm run gui or dist\\Heimdall\\gui.ps1.");
  }

  return window.heimdall;
}
