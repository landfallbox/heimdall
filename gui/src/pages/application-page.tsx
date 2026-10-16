import { Code2, Download, ExternalLink, FolderOpen, Info, RefreshCw, Rocket, RotateCcw, Settings2 } from "lucide-react";

import { Field } from "../components/field.tsx";
import { SegmentedControl } from "../components/segmented-control.tsx";
import { ToggleRow } from "../components/toggle-row.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Separator } from "../components/ui/separator.tsx";
import type { DataDirState } from "../desktop-api.ts";
import type { CloseBehavior } from "../config-draft.ts";
import type { Draft } from "../config-draft.ts";
import type { UpdateState } from "../types.ts";

const closeBehaviorOptions = [
  { value: "tray" as CloseBehavior, label: "Keep in tray" },
  { value: "exit" as CloseBehavior, label: "Exit and stop" },
  { value: "ask" as CloseBehavior, label: "Ask every time" },
];

interface AppSettingsPageProps {
  app: Draft["app"];
  appVersion: string;
  updateState: UpdateState;
  onSetAppSetting: (field: "closeBehavior" | "startAtLogin" | "syncVsCodeModels", value: CloseBehavior | boolean) => Promise<void>;
  onSyncNow: () => Promise<void>;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  dataDirState: DataDirState | null;
  onChangeDataDir: () => void;
  onOpenDataDir: () => void;
  onResetDataDir: () => void;
  busy: string;
}

export function AppSettingsPage({
  app,
  appVersion,
  updateState,
  onSetAppSetting,
  onSyncNow,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  dataDirState,
  onChangeDataDir,
  onOpenDataDir,
  onResetDataDir,
  busy,
}: AppSettingsPageProps) {
  const saving = busy === "saveApp";
  const { status, supported } = updateState;
  const checking = status === "checking";
  const downloading = status === "downloading";
  const newVersion = updateState.availableVersion ? `v${updateState.availableVersion}` : "";
  const showsNewVersion = Boolean(newVersion) && ["available", "downloading", "downloaded"].includes(status);
  const statusPhrase = !supported
    ? "Updates are only available in packaged builds."
    : status === "checking"
      ? "Checking for updates…"
      : status === "available"
        ? "is ready to download"
        : status === "downloading"
          ? `is downloading · ${Math.round(updateState.progress?.percent || 0)}%`
          : status === "downloaded"
            ? "is ready to install"
            : status === "not-available"
              ? "You are on the latest version"
              : status === "error"
                ? "Update check failed"
                : updateState.lastCheckedAt
                  ? `Last checked ${new Date(updateState.lastCheckedAt).toLocaleTimeString()}`
                  : "Not checked yet";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-[15px] font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Settings2 size={16} />
            </span>
            Window
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Field label="Close button">
            <SegmentedControl
              options={closeBehaviorOptions}
              value={app.closeBehavior}
              onChange={(value) => void onSetAppSetting("closeBehavior", value)}
              disabled={saving}
            />
          </Field>
          <Separator />
          <ToggleRow
            label="Start at login"
            checked={app.startAtLogin === true}
            onCheckedChange={(checked) => void onSetAppSetting("startAtLogin", checked)}
            disabled={saving}
            title="Start Heimdall after signing in"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-[15px] font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Code2 size={16} />
            </span>
            VS Code sync
          </CardTitle>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onSyncNow()}
              disabled={busy === "vsCodeSync"}
              title="Merge enabled models into VS Code now."
            >
              {busy === "vsCodeSync" ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              Sync now
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ToggleRow
            label="Sync models to VS Code"
            checked={app.syncVsCodeModels === true}
            onCheckedChange={(checked) => void onSetAppSetting("syncVsCodeModels", checked)}
            disabled={saving}
            description="On every save, merge enabled models into VS Code's chatLanguageModels.json without touching other providers or VS Code secrets."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-[15px] font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <Rocket size={16} />
            </span>
            Updates
          </CardTitle>
          <CardAction className="flex items-center gap-2">
            {status === "available" && (
              <Button type="button" size="sm" onClick={onDownloadUpdate} disabled={downloading} title="Download the new version now.">
                {downloading ? <RefreshCw className="animate-spin" size={14} /> : <Download size={14} />}
                Update now
              </Button>
            )}
            {status === "downloaded" && (
              <Button type="button" size="sm" onClick={onInstallUpdate} title="Restart Heimdall to install the new version.">
                <RotateCcw size={14} />
                Restart to update
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCheckUpdate}
              disabled={!supported || checking}
              title={supported ? "Check GitHub for a newer version now." : "Updates are only available in packaged builds."}
            >
              <RefreshCw size={14} className={checking ? "animate-spin" : undefined} />
              {checking ? "Checking…" : "Check for updates"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span className="shrink-0 text-[13px] font-medium">Current version</span>
            <span className="shrink-0 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[12px]">
              v{appVersion || "dev"}
            </span>
            {showsNewVersion && <span className="shrink-0 text-[13px] text-muted-foreground/50">→</span>}
            {showsNewVersion && <span className="shrink-0 font-mono text-[13px] font-medium text-foreground">{newVersion}</span>}
            <span className="truncate text-[13px] text-muted-foreground">{statusPhrase}</span>
          </div>
          {downloading && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(2, Math.round(updateState.progress?.percent || 0))}%` }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-[15px] font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <FolderOpen size={16} />
            </span>
            Data directory
            {dataDirState?.isCustom && (
              <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                Custom
              </span>
            )}
          </CardTitle>
          <CardAction className="flex items-center gap-2">
            {dataDirState?.isCustom && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onResetDataDir}
                disabled={busy !== "" || dataDirState?.editable !== true}
                title={`Restore the default location: ${dataDirState.defaultDataDir}`}
              >
                <RotateCcw size={14} />
                Reset
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onChangeDataDir}
              disabled={busy !== "" || dataDirState?.editable !== true}
              title={
                dataDirState?.editable === true
                  ? "Move config, logs and usage data to another folder."
                  : "Only the installed app can move its data to another folder."
              }
            >
              <FolderOpen size={14} />
              {busy === "pickDataDir" ? "Choosing…" : busy === "changeDataDir" ? "Moving…" : "Change…"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-black/25 pl-3 pr-1.5">
            <span
              className="min-w-0 flex-1 truncate py-2 font-mono text-[12px] text-muted-foreground"
              title={dataDirState?.dataDir || ""}
            >
              {dataDirState?.dataDir || "Loading…"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={onOpenDataDir}
              disabled={!dataDirState?.dataDir}
              title="Open the data directory in the file manager"
            >
              <ExternalLink size={13} />
            </Button>
          </div>
          {dataDirState?.warning && (
            <p className="text-[12px] text-amber-500">{dataDirState.warning}</p>
          )}
          {dataDirState && dataDirState.editable !== true && (
            <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70">
              <Info size={12} className="shrink-0" />
              Only the installed app can move its data to another folder.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
