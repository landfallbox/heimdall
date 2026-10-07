import type { RemotePricingData } from "../../src/usage.ts";
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

export interface HeimdallDesktopApi {
  getState(): Promise<AppState>;
  rendererReady(): Promise<void>;
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
  openConfig(): Promise<void>;
  openLog(): Promise<void>;
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
