import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { arrayMove } from "@dnd-kit/sortable";
import { ChevronLeft, Layers, RefreshCw, Save, Undo2, XCircle } from "lucide-react";
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
import { VendorsPage } from "./pages/vendors-page.tsx";
import { VendorEditorPage } from "./pages/vendor-editor-page.tsx";
import { UsagePage } from "./pages/usage-page.tsx";
import { LogsPage } from "./pages/logs-page.tsx";

const defaultAppName = "Heimdall";

type Page = PageId | "vendor-edit";

type ModalState =
  | { type: "delete"; index: number; name: string }
  | { type: "deleteVendorModel"; index: number; name: string }
  | { type: "revertVendor" }
  | { type: "enableThinking"; modelIndex: number }
  | { type: "close" }
  | null;

interface StatusView {
  label: string;
  tone: "neutral" | "success" | "warning";
}

function getStatus(health: HealthState | null): StatusView {
  if (!health) {
    return { label: "Checking", tone: "neutral" };
  }

  if (health.ok) {
    return { label: "Running", tone: "success" };
  }

  if (health.processCount > 0) {
    return { label: "Process found", tone: "warning" };
  }

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

function titleForPage(page: Page, vendorEditorDraft: VendorDraft | null) {
  if (page === "vendor-edit") {
    return vendorEditorDraft?.name || "Vendor Settings";
  }

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
  const [isDevelopmentRuntime, setIsDevelopmentRuntime] = useState(false);
  const [configRevision, setConfigRevision] = useState("");
  const vendorModelsRequestRef = useRef(0);
  const vendorModelsSourceKeyRef = useRef("");
  const vendorScrollTargetRef = useRef<number | null>(null);

  const notify = useCallback((message: string, kind: "info" | "error" = "info") => {
    if (!message) {
      return;
    }
    if (kind === "error") {
      toast.error(message);
    } else {
      toast(message);
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
      vendorScrollTargetRef.current = null;
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
    if (page === "logs") {
      void run("logs", refreshLogs);
    }
    if (page === "usage") {
      void run("usage", refreshUsage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (page !== "router" || vendorScrollTargetRef.current == null) {
      return undefined;
    }

    const top = vendorScrollTargetRef.current;
    vendorScrollTargetRef.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top });
    });
    return undefined;
  }, [page]);

  useEffect(() => {
    if (page !== "vendor-edit") {
      return undefined;
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
    });
    return undefined;
  }, [page]);

  async function loadState({ toastMessage = "" }: { toastMessage?: string } = {}) {
    let configLoaded = false;
    setBusy("load");
    try {
      const state = await getDesktopApi().loadConfig();
      setAppName(state.appName || defaultAppName);
      setAppVersion(state.appVersion || "");
      setIsDevelopmentRuntime(Boolean(state.isDevelopmentRuntime));
      const loadedDraft = toDraft(state.config as ConfigInput);
      setConfigRevision(state.revision || "");
      setDraft(loadedDraft);
      setPersistedDraft(loadedDraft);
      setRestartRequired(false);
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

  async function reloadConfig() {
    setModal(null);
    if (page === "vendor-edit") {
      setVendorEditorIndex(null);
      setVendorEditorDraft(null);
      setVendorEditorOriginal(null);
      setVendorEditorIsNew(false);
      clearVendorModelOptions();
      setPage("router");
    }
    await loadState({ toastMessage: "Config reloaded." });
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
    vendorScrollTargetRef.current = window.scrollY;
    setPage("vendor-edit");
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
    vendorScrollTargetRef.current = window.scrollY;
    setPage("vendor-edit");
  }

  function closeVendorEditor() {
    setVendorEditorIndex(null);
    setVendorEditorDraft(null);
    setVendorEditorOriginal(null);
    setVendorEditorIsNew(false);
    setShowVendorKey(false);
    clearVendorModelOptions();
    setPage("router");
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

  async function copyRouterApiKey() {
    if (!draft.router.apiKey) {
      notify("Router API key is empty.", "error");
      return;
    }

    await getDesktopApi().writeClipboard(draft.router.apiKey);
    notify("Router API key copied.");
  }

  async function copyVendorApiKey() {
    if (!vendorEditorDraft?.apiKey) {
      notify("Vendor API key is empty.", "error");
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
    if (target !== "router") {
      vendorScrollTargetRef.current = null;
    }
    closeVendorEditor();
    setPage(target);
  }

  const activePage: PageId = page === "vendor-edit" ? "router" : page;
  return (
    <div className="flex min-h-screen">
      <div className="sticky top-0 hidden h-screen md:block">
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

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur-md">
          <div className="flex items-center justify-between px-8 py-3">
            {page === "vendor-edit" ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={closeVendorEditor}
                  className="flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Back to Router"
                >
                  <ChevronLeft size={15} />
                  Router
                </button>
                <ChevronLeft size={12} className="text-muted-foreground/40" aria-hidden="true" />
                <span className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-bold tracking-tight">
                  <Layers size={14} className="shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">{vendorEditorDraft?.name || "Vendor Settings"}</span>
                </span>
              </div>
            ) : (
              <h1 className="text-xl font-bold tracking-tight">{titleForPage(page, vendorEditorDraft)}</h1>
            )}
            <div className="flex items-center gap-2">
              {page === "vendor-edit" && (
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
              {isDevelopmentRuntime && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void reloadConfig()}
                disabled={busy === "load"}
                title="Reload config"
                aria-label="Reload config"
              >
                <RefreshCw className={busy === "load" ? "animate-spin" : ""} size={16} />
              </Button>
            )}
          </div>
          </div>
        </header>

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
                  <VendorsPage
                    vendors={draft.vendors}
                    vendorHealth={health?.ok ? health.body?.vendors : []}
                    onUpdateVendor={updateVendor}
                    onAddVendor={addVendor}
                    onRemoveVendor={removeVendor}
                    onReorderVendors={reorderVendors}
                    onOpenVendorEditor={openVendorEditor}
                    busy={busy === "vendors"}
                  />
                </div>
              )}
              {page === "vendor-edit" && (
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
