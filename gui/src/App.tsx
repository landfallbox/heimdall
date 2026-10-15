import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { arrayMove } from "@dnd-kit/sortable";
import { FileWarning, Layers, Plus, Save, Server, Undo2, X, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  canLoadVendorModels,
  cloneVendor,
  endpointsFromDraft,
  getVendorModelsErrorField,
  getVendorModelsLoadMessage,
  getVendorModelsSourceKey,
  validateRouter,
  validateVendor,
} from "./app-model.ts";
import {
  defaultDraft,
  toConfig,
  toDraft,
  type CloseBehavior,
  type ConfigInput,
  type Draft,
  type VendorDraft,
  getVendorModels,
} from "./config-draft.ts";
import { useLogsController, usePricingCache, useUpdateController, useUsageController } from "./app-controllers.ts";
import { getDesktopApi, type SaveConfigResult } from "./desktop-api.ts";
import type { HealthState } from "./types.ts";
import { Sidebar, type PageId } from "./components/sidebar.tsx";
import { EndpointRow } from "./components/endpoint-row.tsx";
import { Button } from "./components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { AppSettingsPage } from "./pages/application-page.tsx";
import { RouterPage } from "./pages/router-page.tsx";
import { VendorEditorPage } from "./pages/vendor-editor-page.tsx";
import { VendorsRail } from "./components/vendors-rail.tsx";
import { UsagePage } from "./pages/usage-page.tsx";
import { LogsPage } from "./pages/logs-page.tsx";

const defaultAppName = "Heimdall";

type Page = PageId;

type ModalState =
  | { type: "delete"; index: number; name: string }
  | { type: "deleteVendorModel"; index: number; name: string }
  | { type: "revertVendor" }
  | { type: "enableThinking"; modelIndex: number }
  | { type: "reloadConfig" }
  | { type: "close" }
  | null;

interface StatusView {
  label: string;
  tone: "neutral" | "success" | "warning";
  /** 非运行态的原始错误信息，侧栏状态卡以摘要 + Popover 展示 */
  detail?: string;
}

function getStatus(health: HealthState | null): StatusView {
  if (!health) {
    return { label: "Checking", tone: "neutral" };
  }

  if (health.ok) {
    return { label: "Running", tone: "success" };
  }

  if (health.processCount > 0) {
    return { label: "Process found", tone: "warning", detail: health.error || "Router process is running but not responding." };
  }

  // 未运行时连接被拒绝是必然结果，没有信息量，不展示详情
  return { label: "Stopped", tone: "neutral" };
}

function configSaveMessage(result: SaveConfigResult | null | undefined, savedMessage: string) {
  if (result?.reloadError) {
    return `Settings saved, but Router could not reload them: ${result.reloadError}`;
  }
  if (result?.restartRequired) {
    const fields = Array.isArray(result.restartFields) && result.restartFields.length
      ? ` (${result.restartFields.join(", ")})`
      : "";
    return `Settings saved. Restart Router to apply all changes${fields}.`;
  }
  if (result?.applied) {
    return "Settings saved and applied.";
  }
  return savedMessage;
}

function vsCodeSyncToast(result: SaveConfigResult["vsCodeSync"]) {
  if (!result) {
    return "";
  }
  if (!result.ok) {
    return `VS Code sync failed: ${result.error || "unknown error"}`;
  }
  const created = result.createdProvider ? " Created the Heimdall provider." : "";
  return `Synced ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} to VS Code.${created}`;
}

function titleForPage(page: Page) {
  return {
    application: "Application",
    router: "Router",
    usage: "Token Usage",
    logs: "Runtime Logs",
  }[page];
}

export default function App() {
  const [page, setPage] = useState<Page>("application");
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [persistedDraft, setPersistedDraft] = useState<Draft>(defaultDraft);
  const [health, setHealth] = useState<HealthState | null>(null);
  const [busy, setBusy] = useState("");
  const [showRouterKey, setShowRouterKey] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [showVendorKey, setShowVendorKey] = useState(false);
  const [vendorEditorIndex, setVendorEditorIndex] = useState<number | null>(null);
  const [vendorEditorDraft, setVendorEditorDraft] = useState<VendorDraft | null>(null);
  const [vendorEditorOriginal, setVendorEditorOriginal] = useState<VendorDraft | null>(null);
  const [vendorEditorIsNew, setVendorEditorIsNew] = useState(false);
  const [availableVendorModels, setAvailableVendorModels] = useState<string[]>([]);
  const [vendorModelsError, setVendorModelsError] = useState<{ field: string; message: string } | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [appName, setAppName] = useState(defaultAppName);
  const [appVersion, setAppVersion] = useState("");
  const [configRevision, setConfigRevision] = useState("");
  const [configChanged, setConfigChanged] = useState(false);
  const vendorModelsRequestRef = useRef(0);
  const vendorModelsSourceKeyRef = useRef("");

  const notify = useCallback((message: string, kind: "info" | "error" = "info") => {
    if (!message) {
      return;
    }
    if (kind === "error") {
      toast.error(message);
    } else {
      // info 类型会渲染前置图标，与错误通知的排版节奏保持一致
      toast.info(message);
    }
  }, []);

  const run = useCallback(
    async (name: string, action: () => Promise<void>) => {
      setBusy(name);
      try {
        await action();
      } catch (error) {
        notify((error as Error).message || String(error), "error");
      } finally {
        setBusy("");
      }
    },
    [notify],
  );

  const endpoints = useMemo(() => endpointsFromDraft(draft), [draft]);
  const status = useMemo(() => getStatus(health), [health]);
  const routerValidation = useMemo(() => validateRouter(draft.router), [draft.router]);
  const routerActive = health?.ok || Number(health?.processCount || 0) > 0;
  const { logs, refreshLogs, loadOlderLogs } = useLogsController({ busy, run });
  const { usage, refreshUsage } = useUsageController();
  const { updateState, checkAppUpdate, downloadAppUpdate, installAppUpdate } = useUpdateController({ run, setToast: notify });
  usePricingCache();

  useEffect(() => {
    void loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshHealth({ silent: true, fast: true });
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubscribe = getDesktopApi().onOpenSettings?.(() => {
      closeVendorEditor();
      setPage("application");
      void refreshHealth({ silent: true });
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubscribe = getDesktopApi().onConfirmClose?.(() => {
      setModal({ type: "close" });
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, []);

  useEffect(() => {
    const unsubscribe = getDesktopApi().onConfigChanged?.(() => {
      setConfigChanged(true);
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, []);

  useEffect(() => {
    if (page === "logs") {
      void run("logs", refreshLogs);
    }
    if (page === "usage") {
      void run("usage", refreshUsage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function loadState({ toastMessage = "" }: { toastMessage?: string } = {}) {
    let configLoaded = false;
    setBusy("load");
    try {
      const state = await getDesktopApi().loadConfig();
      setAppName(state.appName || defaultAppName);
      setAppVersion(state.appVersion || "");
      const loadedDraft = toDraft(state.config as ConfigInput);
      setConfigRevision(state.revision || "");
      setDraft(loadedDraft);
      setPersistedDraft(loadedDraft);
      setRestartRequired(false);
      setConfigChanged(false);
      configLoaded = true;
      if (toastMessage) {
        notify(toastMessage);
      }
    } catch (error) {
      notify((error as Error).message || String(error), "error");
    } finally {
      setBusy("");
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          void getDesktopApi().rendererReady();
        });
      });
    }

    if (configLoaded) {
      void refreshHealth({ silent: true, fast: true });
    }
  }

  /** 配置文件在外部被修改后：重新从磁盘加载，Router 运行时先重启以应用新配置。 */
  async function confirmReloadConfig() {
    setModal(null);
    if (routerActive) {
      await restartRouter();
    }
    await loadState();
    setConfigChanged(false);
  }

  async function startRouter() {
    await run("start", async () => {
      const result = await getDesktopApi().startRouter();
      setHealth(result.health);
      setRestartRequired(false);
      notify(result.health?.ok ? "Router started." : result.error || result.health?.error || "Router failed to start.", result.health?.ok ? "info" : "error");
      if (page === "logs") {
        await refreshLogs();
      }
    });
  }

  async function stopRouter() {
    await run("stop", async () => {
      const result = await getDesktopApi().stopRouter();
      setHealth(result.health);
      setRestartRequired(false);
      notify("Router stopped.");
      if (page === "logs") {
        await refreshLogs();
      }
    });
  }

  async function toggleRouter() {
    if (routerActive) {
      await stopRouter();
    } else {
      await startRouter();
    }
  }

  async function restartRouter() {
    await run("restart", async () => {
      const result = await getDesktopApi().restartRouter();
      setHealth(result.health);
      setRestartRequired(false);
      notify(result.health?.ok ? "Router restarted." : result.error || result.health?.error || "Router failed to restart.", result.health?.ok ? "info" : "error");
      if (page === "logs") {
        await refreshLogs();
      }
    });
  }

  async function refreshHealth({ silent = false, fast = false }: { silent?: boolean; fast?: boolean } = {}) {
    try {
      const nextHealth = await getDesktopApi().checkHealth({ includeProcessCount: !fast });
      setHealth(nextHealth);
      if (!silent) {
        notify(nextHealth.ok ? "Health check passed." : "Health check failed.");
      }
      return nextHealth;
    } catch (error) {
      if (!silent) {
        notify((error as Error).message || String(error), "error");
      }
      return null;
    }
  }

  async function writeConfig(nextDraft: Draft) {
    const result = await getDesktopApi().saveConfig({
      config: toConfig(nextDraft),
      revision: configRevision,
    });
    const savedDraft = toDraft(result.config as ConfigInput);
    setConfigRevision(result.revision || "");
    setPersistedDraft(savedDraft);
    setRestartRequired(result.restartRequired === true || Boolean(result.reloadError));
    setConfigChanged(false);
    return { savedDraft, saveResult: result };
  }

  async function saveRouter() {
    if (routerValidation.hasErrors) {
      notify(routerValidation.firstError || "", "error");
      return;
    }

    await run("saveRouter", async () => {
      const { savedDraft, saveResult } = await writeConfig({
        ...persistedDraft,
        router: { ...draft.router },
      });
      setDraft((current) => ({
        ...current,
        router: savedDraft.router,
      }));
      notify(configSaveMessage(saveResult, "Router settings saved."));
    });
  }

  function updateRouter(field: string, value: string) {
    setDraft((current) => ({
      ...current,
      router: { ...current.router, [field]: value },
    }));
  }

  async function setAppSetting(field: "closeBehavior" | "startAtLogin" | "syncVsCodeModels", value: CloseBehavior | boolean) {
    if (busy === "saveApp" || value === persistedDraft.app[field]) {
      return;
    }

    await run("saveApp", async () => {
      const result = await getDesktopApi().saveConfig({
        config: toConfig({
          ...persistedDraft,
          app: { ...persistedDraft.app, [field]: value },
        }),
        revision: configRevision,
      });
      const savedDraft = toDraft(result.config as ConfigInput);
      setConfigRevision(result.revision || "");
      setPersistedDraft(savedDraft);
      setDraft((current) => ({ ...current, app: savedDraft.app }));
      setConfigChanged(false);
      if (field === "syncVsCodeModels" && value === true) {
        notify(vsCodeSyncToast(result.vsCodeSync));
      }
    });
  }

  async function syncVsCodeModelsNow() {
    await run("vsCodeSync", async () => {
      const result = await getDesktopApi().syncVsCodeModels();
      notify(vsCodeSyncToast(result));
    });
  }

  async function persistVendorList(vendors: VendorDraft[], message?: string) {
    try {
      const { savedDraft, saveResult } = await writeConfig({ ...persistedDraft, vendors });
      setDraft((current) => ({ ...current, vendors: savedDraft.vendors }));
      if (message) {
        notify(configSaveMessage(saveResult, message));
      }
    } catch (error) {
      setDraft((current) => ({ ...current, vendors: persistedDraft.vendors }));
      throw error;
    }
  }

  function updateVendor(index: number, field: string, value: unknown) {
    const nextVendor: VendorDraft = { ...draft.vendors[index], [field]: value };
    if (field === "enabled" && value && validateVendor(nextVendor).hasErrors) {
      notify("Fix the red Vendor errors before enabling it.", "error");
      return;
    }

    const vendors = draft.vendors.map((vendor, vendorIndex) => (vendorIndex === index ? nextVendor : vendor));
    setDraft((current) => ({ ...current, vendors }));
    void run("vendors", () => persistVendorList(vendors));
  }

  function addVendor() {
    const vendor: VendorDraft = {
      name: "new-vendor",
      baseUrl: "https://example.com/v1",
      models: [],
      authentication: "none",
      requestFormat: "chat-completions",
      enabled: false,
    };

    setVendorEditorIndex(draft.vendors.length);
    setVendorEditorDraft(cloneVendor(vendor));
    setVendorEditorOriginal(cloneVendor(vendor));
    setVendorEditorIsNew(true);
    setShowVendorKey(false);
    clearVendorModelOptions();
  }

  function removeVendor(index: number) {
    const vendorName = draft.vendors[index]?.name || "this vendor";
    setModal({ type: "delete", index, name: vendorName });
  }

  function confirmRemoveVendor() {
    if (!modal) return;
    const index = modal.type === "delete" ? modal.index : 0;
    const vendors = draft.vendors.filter((_vendor, vendorIndex) => vendorIndex !== index);
    setDraft((current) => ({ ...current, vendors }));
    setModal(null);
    void run("vendors", () => persistVendorList(vendors, "Vendor deleted."));
  }

  function reorderVendors(sourceIndex: number, targetIndex: number) {
    if (
      sourceIndex === targetIndex
      || sourceIndex < 0
      || targetIndex < 0
      || sourceIndex >= draft.vendors.length
      || targetIndex >= draft.vendors.length
    ) {
      return;
    }

    const vendors = arrayMove(draft.vendors, sourceIndex, targetIndex);
    setDraft((current) => ({ ...current, vendors }));
    void run("vendors", () => persistVendorList(vendors));
  }

  function openVendorEditor(index: number) {
    const vendor = cloneVendor(draft.vendors[index]);
    setVendorEditorIndex(index);
    setVendorEditorDraft(vendor);
    setVendorEditorOriginal(cloneVendor(vendor));
    setVendorEditorIsNew(false);
    setShowVendorKey(false);
    clearVendorModelOptions();
  }

  function closeVendorEditor() {
    setVendorEditorIndex(null);
    setVendorEditorDraft(null);
    setVendorEditorOriginal(null);
    setVendorEditorIsNew(false);
    setShowVendorKey(false);
    clearVendorModelOptions();
  }

  function updateVendorEditor(field: string, value: unknown) {
    setVendorEditorDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateVendorEditorModel(modelIndex: number, field: string, value: unknown) {
    if (field === "enableThinking" && value === true) {
      setModal({ type: "enableThinking", modelIndex });
      return;
    }
    setVendorEditorDraft((current) => {
      const models = getVendorModels(current).map((model, index) => (index === modelIndex ? { ...model, [field]: value } : model));
      return { ...current, models };
    });
  }

  function confirmEnableThinking() {
    if (!modal) return;
    const modelIndex = modal.type === "enableThinking" ? modal.modelIndex : 0;
    setVendorEditorDraft((current) => {
      const models = getVendorModels(current).map((model, index) => (index === modelIndex ? { ...model, enableThinking: true } : model));
      return { ...current, models };
    });
    setModal(null);
  }

  function addVendorEditorModel() {
    setVendorEditorDraft((current) => ({
      ...current,
      models: [...getVendorModels(current), { id: "", enabled: true }],
    }));
  }

  async function loadVendorModels(
    vendor: VendorDraft | null,
    { silent = false, force = false, sourceKey = getVendorModelsSourceKey(vendor) }: { silent?: boolean; force?: boolean; sourceKey?: string } = {},
  ) {
    if (!vendor) {
      return;
    }
    if (!canLoadVendorModels(vendor)) {
      const message = getVendorModelsLoadMessage(vendor);
      setVendorModelsError(null);
      if (!silent) {
        notify(message);
      }
      return;
    }
    if (!force && sourceKey === vendorModelsSourceKeyRef.current) {
      return;
    }
    if (typeof getDesktopApi().listVendorModels !== "function") {
      if (!silent) {
        notify("Restart the desktop app to enable model list loading.");
      }
      return;
    }

    const requestId = vendorModelsRequestRef.current + 1;
    vendorModelsRequestRef.current = requestId;
    vendorModelsSourceKeyRef.current = sourceKey;
    setAvailableVendorModels([]);
    setVendorModelsError(null);
    if (!silent) {
      setBusy("vendorModels");
    }

    try {
      const result = await getDesktopApi().listVendorModels(vendor);
      if (requestId !== vendorModelsRequestRef.current || sourceKey !== vendorModelsSourceKeyRef.current) {
        return;
      }
      setAvailableVendorModels(result.models || []);
      setVendorModelsError(null);
      if (!silent) {
        notify(`Loaded ${(result.models || []).length} models.`);
      }
    } catch (error) {
      if (requestId !== vendorModelsRequestRef.current || sourceKey !== vendorModelsSourceKeyRef.current) {
        return;
      }
      const fieldError = getVendorModelsErrorField(error, vendor);
      setVendorModelsError(fieldError);
      if (!silent) {
        notify(fieldError.message, "error");
      }
    } finally {
      if (!silent && requestId === vendorModelsRequestRef.current) {
        setBusy((current) => (current === "vendorModels" ? "" : current));
      }
    }
  }

  async function refreshVendorModels() {
    await loadVendorModels(vendorEditorDraft, { force: true });
  }

  async function loadVendorModelsOnSelect() {
    await loadVendorModels(vendorEditorDraft, { silent: true });
  }

  function removeVendorEditorModel(modelIndex: number) {
    setVendorEditorDraft((current) => {
      if (!current) return current;
      const models = getVendorModels(current).filter((_model, index) => index !== modelIndex);
      return { ...current, models };
    });
  }

  function requestRemoveVendorEditorModel(modelIndex: number) {
    const modelId = getVendorModels(vendorEditorDraft)[modelIndex]?.id || "this model";
    setModal({ type: "deleteVendorModel", index: modelIndex, name: modelId });
  }

  function confirmRemoveVendorEditorModel() {
    if (!modal) return;
    removeVendorEditorModel(modal.type === "deleteVendorModel" ? modal.index : 0);
    setModal(null);
  }

  async function saveVendorEditor() {
    await run("save", async () => {
      if (!vendorEditorDraft) return;
      const savedVendor = cloneVendor(vendorEditorDraft)!;
      const validation = validateVendor(savedVendor);
      if (validation.hasErrors) {
        notify("Fix the red Vendor errors before saving.", "error");
        return;
      }
      const savedIndex = vendorEditorIsNew ? persistedDraft.vendors.length : vendorEditorIndex!;
      const nextDraft: Draft = {
        ...persistedDraft,
        vendors: vendorEditorIsNew
          ? [...persistedDraft.vendors, savedVendor]
          : persistedDraft.vendors.map((vendor, index) => (index === vendorEditorIndex ? savedVendor : vendor)),
      };
      const { savedDraft, saveResult } = await writeConfig(nextDraft);
      const persistedVendor = cloneVendor(savedDraft.vendors[savedIndex]);

      setDraft((current) => ({ ...current, vendors: savedDraft.vendors }));
      setVendorEditorIndex(savedIndex);
      setVendorEditorDraft(persistedVendor);
      setVendorEditorOriginal(cloneVendor(persistedVendor));
      setVendorEditorIsNew(false);
      notify(configSaveMessage(saveResult, "Vendor saved to config.json."));
    });
  }

  function revertVendorEditor() {
    setVendorEditorDraft(cloneVendor(vendorEditorOriginal) ?? null);
    notify("Vendor changes reverted.");
  }

  function requestRevertVendorEditor() {
    setModal({ type: "revertVendor" });
  }

  function confirmRevertVendorEditor() {
    revertVendorEditor();
    setModal(null);
  }

  async function copyEndpoint(endpoint: string, label: string) {
    await getDesktopApi().writeClipboard(endpoint);
    notify(`${label} endpoint copied.`);
  }

  // 校验失败时让对应输入框就地聚焦并短暂红色高亮，避免视线在通知和表单间来回找
  function flashInputError(ariaLabel: string) {
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${ariaLabel}"]`);
    if (!input) {
      return;
    }
    input.focus();
    input.classList.remove("input-error-flash");
    void input.offsetWidth; // 强制回流，允许连续触发时重启动画
    input.classList.add("input-error-flash");
  }

  async function copyRouterApiKey() {
    if (!draft.router.apiKey) {
      notify("Router API key is empty.", "error");
      flashInputError("Router API key");
      return;
    }

    await getDesktopApi().writeClipboard(draft.router.apiKey);
    notify("Router API key copied.");
  }

  async function copyVendorApiKey() {
    if (!vendorEditorDraft?.apiKey) {
      notify("Vendor API key is empty.", "error");
      flashInputError("Vendor API key");
      return;
    }

    await getDesktopApi().writeClipboard(vendorEditorDraft.apiKey);
    notify("Vendor API key copied.");
  }

  function clearVendorModelOptions() {
    vendorModelsRequestRef.current += 1;
    vendorModelsSourceKeyRef.current = "";
    setAvailableVendorModels([]);
    setVendorModelsError(null);
    setBusy((current) => (current === "vendorModels" ? "" : current));
  }

  async function hideWindowToTray() {
    setModal(null);
    await getDesktopApi().hideToTray();
  }

  async function cancelWindowClose() {
    setModal(null);
    await getDesktopApi().cancelClose();
  }

  async function quitAndStopRouter() {
    setModal(null);
    await getDesktopApi().quitAndStop();
  }

  function navigateTo(target: PageId) {
    closeVendorEditor();
    setPage(target);
  }

  const activePage: PageId = page;
  return (
    <div className="app-shell flex h-screen overflow-hidden">
      <div className="hidden h-full shrink-0 md:block">
        <Sidebar
          appName={appName}
          appVersion={appVersion}
          page={activePage}
          onNavigate={navigateTo}
          status={status}
          restartRequired={restartRequired}
          routerActive={routerActive}
          busy={busy}
          updateState={updateState}
          onCheckUpdate={checkAppUpdate}
          onDownloadUpdate={downloadAppUpdate}
          onInstallUpdate={installAppUpdate}
          onToggleRouter={toggleRouter}
          onRestartRouter={restartRouter}
        />
      </div>

      <main className="inset-canvas m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-canvas shadow-card">
        <header className="canvas-header shrink-0 border-b border-border/60">
          <div className="flex items-center justify-between px-8 py-3">
            {vendorEditorDraft ? (
              <h1 className="flex min-w-0 items-center gap-2 text-xl font-bold tracking-tight">
                <Layers size={17} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{vendorEditorDraft.name || "Vendor Settings"}</span>
              </h1>
            ) : (
              <h1 className="text-xl font-bold tracking-tight">{titleForPage(page)}</h1>
            )}
            <div className="flex min-w-0 items-center gap-2">
              {configChanged && (
                <div
                  role="alert"
                  className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-warning/35 bg-muted/40 pl-3 pr-1.5 text-xs text-warning"
                >
                  <FileWarning size={14} className="shrink-0" />
                  <span className="truncate">Config changed on disk</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6 rounded-full px-2 text-xs"
                    onClick={() => setModal({ type: "reloadConfig" })}
                  >
                    {routerActive ? "Restart" : "Reload"}
                  </Button>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    className="rounded-full p-1 opacity-60 transition hover:opacity-100"
                    onClick={() => setConfigChanged(false)}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {vendorEditorDraft && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={requestRevertVendorEditor}
                    title="Revert unsaved changes"
                  >
                    <Undo2 size={14} />
                    Revert
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void saveVendorEditor()}
                    disabled={busy === "save"}
                    title="Save vendor"
                  >
                    <Save size={14} />
                    Save
                  </Button>
                </>
              )}
          </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1100px] px-8 py-6">
          {page === "router" && (
            <motion.section
              aria-label="Router endpoints"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="mb-4 grid grid-cols-1 gap-3"
            >
              <EndpointRow label="Chat Completions" endpoint={endpoints.chatCompletions} onCopy={(endpoint, label) => void copyEndpoint(endpoint, label)} />
              <EndpointRow label="Responses" endpoint={endpoints.responses} onCopy={(endpoint, label) => void copyEndpoint(endpoint, label)} />
            </motion.section>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              {page === "application" && (
                <AppSettingsPage
                  app={draft.app}
                  onSetAppSetting={setAppSetting}
                  onSyncNow={syncVsCodeModelsNow}
                  busy={busy}
                />
              )}
              {page === "router" && (
                <div className="flex flex-col gap-4">
                  <RouterPage
                    draft={draft}
                    onUpdateRouter={updateRouter}
                    showRouterKey={showRouterKey}
                    onSetShowRouterKey={setShowRouterKey}
                    onCopyRouterApiKey={copyRouterApiKey}
                    onSaveRouter={saveRouter}
                    busy={busy}
                    validation={routerValidation}
                  />
                  <section
                    aria-label="Vendors"
                    className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card/40 xl:grid-cols-[230px_minmax(0,1fr)]"
                  >
                    <div className="border-b border-border bg-muted/20 xl:border-b-0 xl:border-r">
                      <VendorsRail
                        vendors={draft.vendors}
                        selectedIndex={vendorEditorIndex}
                        hasUnsavedNew={vendorEditorIsNew}
                        unsavedName={vendorEditorDraft?.name ?? ""}
                        onAddVendor={addVendor}
                        onRemoveVendor={removeVendor}
                        onReorderVendors={reorderVendors}
                        onSelectVendor={openVendorEditor}
                        onEnableChange={(index, enabled) => updateVendor(index, "enabled", enabled)}
                        busy={busy === "vendors"}
                      />
                    </div>
                    <div className="min-w-0 p-5">
                      {vendorEditorDraft ? (
                        <VendorEditorPage
                          vendor={vendorEditorDraft}
                          onUpdateVendor={updateVendorEditor}
                          onUpdateVendorModel={updateVendorEditorModel}
                          onAddVendorModel={addVendorEditorModel}
                          onRemoveVendorModel={requestRemoveVendorEditorModel}
                          availableModels={availableVendorModels}
                          vendorModelsError={vendorModelsError}
                          onRefreshVendorModels={refreshVendorModels}
                          onLoadVendorModelsOnSelect={loadVendorModelsOnSelect}
                          showVendorKey={showVendorKey}
                          onSetShowVendorKey={setShowVendorKey}
                          onCopyVendorApiKey={copyVendorApiKey}
                          onSaveVendor={saveVendorEditor}
                          onRevertVendor={requestRevertVendorEditor}
                          busy={busy}
                        />
                      ) : (
                        <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 text-muted-foreground">
                          <Server size={22} className="opacity-50" aria-hidden="true" />
                          <p className="text-sm">Select a vendor to edit its settings</p>
                          <Button variant="outline" size="sm" onClick={addVendor}>
                            <Plus size={14} />
                            Add vendor
                          </Button>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              )}
              {page === "usage" && <UsagePage usage={usage} onRefreshUsage={(options) => void run("usage", () => refreshUsage(options))} busy={busy} />}
              {page === "logs" && (
                <LogsPage
                  logs={logs}
                  onRefreshLogs={() => run("logs", refreshLogs)}
                  onLoadOlderLogs={loadOlderLogs}
                  onOpenLog={() => run("openLog", () => getDesktopApi().openLog())}
                  onOpenConfig={() => run("openConfig", () => getDesktopApi().openConfig())}
                  busy={busy}
                />
              )}
            </motion.div>
          </AnimatePresence>
          </div>
        </div>
      </main>

      <Dialog open={modal?.type === "delete"} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete vendor</DialogTitle>
            <DialogDescription>This removes the vendor immediately.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemoveVendor}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal?.type === "deleteVendorModel"} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete model</DialogTitle>
            <DialogDescription>This removes the model from the current vendor draft.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemoveVendorEditorModel}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal?.type === "revertVendor"} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revert vendor changes</DialogTitle>
            <DialogDescription>Revert all unsaved changes for this vendor?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRevertVendorEditor}>
              Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal?.type === "enableThinking"} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable thinking mode</DialogTitle>
            <DialogDescription>
              This only works for models served by a vLLM endpoint that supports the{" "}
              <code className="rounded-sm bg-muted px-1 font-mono">chat_template_kwargs.enable_thinking</code> parameter.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            For any other model or deployment, keep it off: the parameter is ignored or rejected by the upstream.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button onClick={confirmEnableThinking}>Enable</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal?.type === "reloadConfig"} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reload config</DialogTitle>
            <DialogDescription>
              The config file was changed outside the GUI. Reloading will replace
              unsaved edits in this window with the on-disk values
              {routerActive ? ", and the Router will be restarted to apply them." : "."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={() => void confirmReloadConfig()}>Reload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal?.type === "close"} onOpenChange={(open) => { if (!open) void cancelWindowClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {appName}</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
              <XCircle size={20} />
            </div>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <p>Keep Router available from the system tray or menu bar, or exit and stop it now.</p>
              <span>Tray keeps Settings one double-click away.</span>
              <span>Exit stops the local Router process before closing.</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => void cancelWindowClose()}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => void quitAndStopRouter()}>
              Exit and stop Router
            </Button>
            <Button autoFocus onClick={() => void hideWindowToTray()}>
              Keep running in tray
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster />
    </div>
  );
}
