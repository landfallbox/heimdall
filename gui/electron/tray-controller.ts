import { Menu, nativeImage, Notification, Tray, type MenuItemConstructorOptions } from "electron";
import type { HealthState, RouterActionResult, UpdateState } from "../src/types.ts";

const REFRESH_INTERVAL_MS = 15000;

interface TrayStatus {
  label: string;
  detail: string;
  isRouterActive: boolean;
}

interface TrayControllerOptions {
  createAppIcon: () => ReturnType<typeof nativeImage.createFromPath> | null;
  downloadUpdate: () => Promise<unknown>;
  getHealth: () => Promise<HealthState | null>;
  getUpdateState: () => UpdateState;
  installUpdate: () => Promise<unknown>;
  isQuitting: () => boolean;
  openLogFile: () => Promise<unknown>;
  quitApplication: () => void;
  restartRouter: () => Promise<RouterActionResult>;
  showSettingsWindow: () => void;
  startRouter: () => Promise<RouterActionResult>;
  stopRouter: () => Promise<RouterActionResult>;
}

export function createTrayController({
  createAppIcon,
  downloadUpdate,
  getHealth,
  getUpdateState,
  installUpdate,
  isQuitting,
  openLogFile,
  quitApplication,
  restartRouter,
  showSettingsWindow,
  startRouter,
  stopRouter,
}: TrayControllerOptions) {
  let tray: Tray | null = null;
  let refreshTimer: NodeJS.Timeout | null = null;
  let busyAction = "";
  let status: TrayStatus = { label: "Checking", detail: "", isRouterActive: false };

  function showNotification(title: string, body: string) {
    if (Notification.isSupported()) {
      new Notification({ title, body: String(body || "") }).show();
    }
  }

  function updateMenu() {
    if (!tray) {
      return;
    }

    const updateState = getUpdateState();
    const items: MenuItemConstructorOptions[] = [
      { label: `Current status: ${status.label}`, enabled: false },
      { type: "separator" },
      { label: "Open Settings", click: showSettingsWindow },
      { label: "Open Logs", click: () => void openLogFile().catch((error: unknown) => showNotification("Heimdall", (error as Error).message || String(error))) },
    ];

    if (busyAction) {
      items.push({ label: busyAction, enabled: false });
    } else if (status.isRouterActive) {
      items.push(
        { label: "Stop Router", click: () => void runRouterAction("Stopping Router...", stopRouter, "Heimdall failed to stop") },
        { label: "Restart Router", click: () => void runRouterAction("Restarting Router...", restartRouter, "Heimdall failed to restart", "Heimdall restart issue") },
      );
    } else {
      items.push({ label: "Start Router", click: () => void runRouterAction("Starting Router...", startRouter, "Heimdall failed to start", "Heimdall startup issue") });
    }

    if (["available", "downloading", "downloaded"].includes(updateState.status)) {
      items.push({ type: "separator" });
      if (updateState.status === "available") {
        items.push({ label: `Download update ${updateState.availableVersion}`, click: () => void runUpdateDownload() });
      } else if (updateState.status === "downloading") {
        const percent = Number(updateState.progress?.percent || 0).toFixed(0);
        items.push({ label: `Downloading update ${percent}%`, enabled: false });
      } else {
        items.push({ label: `Install update ${updateState.availableVersion}`, click: () => void runUpdateInstall() });
      }
    }

    items.push(
      { type: "separator" },
      { label: "Exit", click: () => void quitApplication() },
    );

    const routerState = status.isRouterActive ? "Running" : "Stopped";
    tray.setToolTip(`heimdall: ${routerState}${status.detail ? `\n${status.detail}` : ""}`);
    tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  function create(): Tray {
    if (tray) {
      return tray;
    }

    tray = new Tray(createAppIcon() || createFallbackIcon());
    tray.on("double-click", showSettingsWindow);
    updateMenu();

    refreshTimer = setInterval(() => {
      void refreshStatus(null, { notifyOnUnexpectedStop: true });
    }, REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
    return tray;
  }

  function setConfigurationIssue(detail: string) {
    status = { label: "Stopped", detail, isRouterActive: false };
    updateMenu();
  }

  async function refreshStatus(health: HealthState | null = null, { notifyOnUnexpectedStop = false }: { notifyOnUnexpectedStop?: boolean } = {}): Promise<HealthState | null> {
    if (!tray) {
      return health;
    }

    const nextHealth = health || (await getHealth());
    const nextStatus = statusFromHealth(nextHealth);
    if (notifyOnUnexpectedStop && status.isRouterActive && !nextStatus.isRouterActive && !isQuitting()) {
      showNotification("Heimdall stopped", nextStatus.detail || "The router process is no longer running.");
    }

    status = nextStatus;
    updateMenu();
    return nextHealth;
  }

  async function runRouterAction(label: string, action: () => Promise<RouterActionResult>, errorTitle: string, unhealthyTitle = "") {
    setBusy(label);
    try {
      const result = await action();
      if (unhealthyTitle && !result?.health?.ok) {
        showNotification(unhealthyTitle, healthDetail(result?.health));
      }
    } catch (error) {
      showNotification(errorTitle, (error as Error).message || String(error));
    } finally {
      setBusy("");
    }
  }

  async function runUpdateDownload() {
    setBusy("Downloading update...");
    try {
      await downloadUpdate();
    } catch {
      // Download failures are surfaced through the update state.
    } finally {
      setBusy("");
    }
  }

  async function runUpdateInstall() {
    try {
      await installUpdate();
    } catch (error) {
      showNotification("Heimdall update failed", (error as Error).message || String(error));
    }
  }

  function setBusy(label: string) {
    busyAction = label;
    updateMenu();
  }

  function dispose() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  return {
    create,
    dispose,
    refreshStatus,
    setBusy,
    setConfigurationIssue,
    showNotification,
    updateMenu,
  };
}

export function healthDetail(health: HealthState | null | undefined): string {
  if (!health) {
    return "No health result is available.";
  }

  return health.error || health.text || (health.body as { model?: string } | null | undefined)?.model || health.url || "Router did not report healthy.";
}

function statusFromHealth(health: HealthState | null): TrayStatus {
  if (!health) {
    return { label: "Checking", detail: "", isRouterActive: false };
  }
  if (health.ok) {
    return { label: "Running", detail: "", isRouterActive: true };
  }
  if (Number(health.processCount || 0) > 0) {
    return { label: "Process found", detail: health.error || "Health check failed.", isRouterActive: true };
  }
  return { label: "Stopped", detail: health.error || "", isRouterActive: false };
}

function createFallbackIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const distance = Math.hypot(x - 7.5, y - 7.5);
      if (distance > 7.5) {
        continue;
      }

      const isRouteLine = (x >= 4 && x <= 11 && y >= 4 && y <= 5) || (x >= 10 && x <= 11 && y >= 4 && y <= 11);
      buffer[offset] = isRouteLine ? 244 : 34;
      buffer[offset + 1] = isRouteLine ? 247 : 197;
      buffer[offset + 2] = isRouteLine ? 251 : 94;
      buffer[offset + 3] = 255;
    }
  }

  return nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: 1 });
}
