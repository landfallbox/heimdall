import { useEffect, useState } from "react";
import { applyRemotePricing } from "../../src/usage.ts";
import { getDesktopApi } from "./desktop-api.ts";
import type { LogPage, UpdateState, UsageSummary } from "./types.ts";

const PRICING_CACHE_POLL_MS = 5 * 60 * 1000;

const defaultUpdateState: UpdateState = {
  status: "unsupported",
  supported: false,
  currentVersion: "",
  availableVersion: "",
  releaseName: "",
  releaseNotes: "",
  progress: null,
  error: "",
  lastCheckedAt: "",
};

export function useLogsController({ busy, run }: { busy: string; run: (name: string, action: () => Promise<void>) => Promise<void> }) {
  const [logs, setLogs] = useState<LogPage>({ path: "", lines: [], nextBefore: null, hasMore: false });

  async function refreshLogs() {
    const result = await getDesktopApi().readLogs({ limit: 80 });
    setLogs(result);
  }

  async function loadOlderLogs() {
    if (!logs.hasMore || busy === "olderLogs") {
      return;
    }

    await run("olderLogs", async () => {
      const result = await getDesktopApi().readLogs({ limit: 80, before: logs.nextBefore });
      setLogs((current) => ({
        path: result.path || current.path,
        lines: [...result.lines, ...current.lines],
        nextBefore: result.nextBefore,
        hasMore: result.hasMore,
      }));
    });
  }

  return { logs, refreshLogs, loadOlderLogs };
}

export function useUsageController() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  async function refreshUsage(options?: { vendor?: string; model?: string }) {
    const result = await getDesktopApi().readUsageSummary(options);
    setUsage(result);
  }

  return { usage, refreshUsage };
}

export function usePricingCache() {
  const [pricingUpdatedAt, setPricingUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let lastUpdatedAt: string | null = null;

    async function refreshPricingCache() {
      try {
        const result = await getDesktopApi().loadPricingCache();
        const data = result?.data;
        if (!active || !data || !data.updatedAt || data.updatedAt === lastUpdatedAt) {
          return;
        }
        lastUpdatedAt = data.updatedAt;
        applyRemotePricing(data);
        setPricingUpdatedAt(data.updatedAt);
      } catch {
        // Best-effort: the built-in catalogs stay available when the cache is missing or invalid.
      }
    }

    void refreshPricingCache();
    const timer = window.setInterval(() => {
      void refreshPricingCache();
    }, PRICING_CACHE_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return { pricingUpdatedAt };
}

export function useUpdateController({ run, setToast }: { run: (name: string, action: () => Promise<void>) => Promise<void>; setToast: (toast: string) => void }) {
  const [updateState, setUpdateState] = useState<UpdateState>(defaultUpdateState);

  useEffect(() => {
    const api = getDesktopApi();
    void api.getUpdateState?.().then((state) => {
      if (state) {
        setUpdateState(state);
      }
    }).catch(() => null);

    const unsubscribe = api.onUpdateState?.((state) => {
      if (state) {
        setUpdateState(state);
      }
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, []);

  async function checkAppUpdate() {
    await run("updateCheck", async () => {
      const state = await getDesktopApi().checkForUpdates({ manual: true });
      setUpdateState(state);
      setToast(updateToastForState(state, "Update check completed."));
    });
  }

  async function downloadAppUpdate() {
    await run("updateDownload", async () => {
      const state = await getDesktopApi().downloadUpdate();
      setUpdateState(state);
      setToast(updateToastForState(state, "Update download started."));
    });
  }

  async function installAppUpdate() {
    await run("updateInstall", async () => {
      const state = await getDesktopApi().installUpdate();
      setUpdateState(state);
      setToast(updateToastForState(state, "Installing update."));
    });
  }

  return { updateState, checkAppUpdate, downloadAppUpdate, installAppUpdate };
}

function updateToastForState(updateState: UpdateState, fallback: string): string {
  if (!updateState) {
    return fallback;
  }
  if (!updateState.supported) {
    return updateState.error || "Updates are available only in supported packaged builds.";
  }
  if (updateState.status === "available") {
    return `Version ${updateState.availableVersion} is available.`;
  }
  if (updateState.status === "downloaded") {
    return "Update downloaded. Restart to update.";
  }
  if (updateState.status === "installed") {
    return "Mock update install completed.";
  }
  if (updateState.status === "not-available") {
    return "You are up to date.";
  }
  if (updateState.status === "error") {
    return updateState.error || "Update failed.";
  }
  return fallback;
}
