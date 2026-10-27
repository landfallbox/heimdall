import { useEffect, useRef, useState } from "react";
import { applyModelInfo } from "../../src/model-info.ts";
import { applyRemotePricing } from "../../src/usage.ts";
import { DEFAULT_LOGS_FILTER, logLineMatchesFilter, toLogFilter, type LogsFilterState } from "./app-model.ts";
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

const LOG_PAGE_LIMIT = 200;
const LOG_LINES_HARD_CAP = 1500;

export function useLogsController({ busy, run, active }: { busy: string; run: (name: string, action: () => Promise<void>) => Promise<void>; active: boolean }) {
  const [logs, setLogs] = useState<LogPage>({ dir: "", lines: [], nextCursor: null, hasMore: false });
  const [filterState, setFilterState] = useState<LogsFilterState>(DEFAULT_LOGS_FILTER);

  const filterRef = useRef(filterState);
  useEffect(() => {
    filterRef.current = filterState;
  }, [filterState]);

  function appendLines(newLines: string[]) {
    if (newLines.length === 0) {
      return;
    }
    setLogs((current) => {
      const merged = [...current.lines, ...newLines];
      return {
        ...current,
        lines: merged.length > LOG_LINES_HARD_CAP ? merged.slice(merged.length - LOG_LINES_HARD_CAP) : merged,
      };
    });
  }

  async function refreshLogs() {
    const result = await getDesktopApi().readLogs({ limit: LOG_PAGE_LIMIT, ...toLogFilter(filterRef.current) });
    setLogs({ dir: result.dir, lines: result.lines, nextCursor: result.nextCursor, hasMore: result.hasMore });
  }

  async function loadOlderLogs() {
    if (!logs.hasMore || busy === "olderLogs") {
      return;
    }

    await run("olderLogs", async () => {
      const result = await getDesktopApi().readLogs({ limit: LOG_PAGE_LIMIT, cursor: logs.nextCursor, ...toLogFilter(filterRef.current) });
      setLogs((current) => ({
        dir: result.dir || current.dir,
        lines: [...result.lines, ...current.lines],
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      }));
    });
  }

  // 过滤条件变化 → 视图重置到最新匹配项（spec §4）
  async function updateFilterState(next: LogsFilterState) {
    setFilterState(next);
    filterRef.current = next;
    await run("logs", async () => {
      const result = await getDesktopApi().readLogs({ limit: LOG_PAGE_LIMIT, ...toLogFilter(next) });
      setLogs({ dir: result.dir, lines: result.lines, nextCursor: result.nextCursor, hasMore: result.hasMore });
    });
  }

  // 仅 Logs 页挂载时订阅 follow 流；推送原始行，按当前过滤状态客户端过滤后始终追加
  useEffect(() => {
    if (!active) {
      return;
    }
    const unsubscribe = getDesktopApi().onLogsAppended?.((event) => {
      const matched = event.lines.filter((line) => logLineMatchesFilter(line, toLogFilter(filterRef.current)));
      if (matched.length === 0) {
        return;
      }
      appendLines(matched);
    });
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [active]);

  return {
    logs,
    refreshLogs,
    loadOlderLogs,
    filterState,
    updateFilterState,
  };
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

export function useModelInfoCache() {
  const [modelInfoUpdatedAt, setModelInfoUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let lastUpdatedAt: string | null = null;
    // Same-day catalog changes keep the same updatedAt date, so the model
    // content is fingerprinted as well to pick them up.
    let lastModelsFingerprint: string | null = null;

    async function refreshModelInfoCache() {
      try {
        const result = await getDesktopApi().loadModelInfoCache();
        const data = result?.data;
        if (!active || !data || !data.updatedAt) {
          return;
        }
        const modelsFingerprint = JSON.stringify(data.models);
        if (data.updatedAt === lastUpdatedAt && modelsFingerprint === lastModelsFingerprint) {
          return;
        }
        lastUpdatedAt = data.updatedAt;
        lastModelsFingerprint = modelsFingerprint;
        applyModelInfo(data);
        setModelInfoUpdatedAt(data.updatedAt);
      } catch {
        // Best-effort: the built-in model info stays available when the cache is missing or invalid.
      }
    }

    void refreshModelInfoCache();
    const timer = window.setInterval(() => {
      void refreshModelInfoCache();
    }, PRICING_CACHE_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return { modelInfoUpdatedAt };
}

export function useUpdateController({ run, setToast }: { run: (name: string, action: () => Promise<void>) => Promise<void>; setToast: (toast: string, kind?: "info" | "error") => void }) {
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
      const isError = state?.status === "error";
      setToast(updateToastForState(state, "Update check completed."), isError ? "error" : "info");
    });
  }

  async function downloadAppUpdate() {
    await run("updateDownload", async () => {
      const state = await getDesktopApi().downloadUpdate();
      setUpdateState(state);
      const isError = state?.status === "error";
      setToast(updateToastForState(state, "Update download started."), isError ? "error" : "info");
    });
  }

  async function installAppUpdate() {
    await run("updateInstall", async () => {
      const state = await getDesktopApi().installUpdate();
      setUpdateState(state);
      const isError = state?.status === "error";
      setToast(updateToastForState(state, "Installing update."), isError ? "error" : "info");
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
