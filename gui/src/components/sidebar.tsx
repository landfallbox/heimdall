import { Gauge, Loader2, Play, RefreshCw, RotateCcw, Settings2, Server, Square, Terminal, type LucideIcon } from "lucide-react";

import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { StatusDot, type StatusTone } from "./status-dot.tsx";
import type { UpdateState } from "../types.ts";

export type PageId = "application" | "router" | "usage" | "logs";

export const navItems: Array<{ id: PageId; label: string; icon: LucideIcon }> = [
  { id: "application", label: "Application", icon: Settings2 },
  { id: "router", label: "Router", icon: Server },
  { id: "usage", label: "Usage", icon: Gauge },
  { id: "logs", label: "Logs", icon: Terminal },
];

interface SidebarStatus {
  label: string;
  tone: StatusTone;
}

interface SidebarProps {
  appName: string;
  appVersion: string;
  page: PageId;
  onNavigate: (page: PageId) => void;
  status: SidebarStatus;
  restartRequired: boolean;
  routerActive: boolean;
  busy: string;
  updateState: UpdateState;
  onCheckUpdate: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onToggleRouter: () => Promise<void>;
  onRestartRouter: () => Promise<void>;
}

export function Sidebar({
  appName,
  appVersion,
  page,
  onNavigate,
  status,
  restartRequired,
  routerActive,
  busy,
  updateState,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onToggleRouter,
  onRestartRouter,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-[15px] font-bold text-primary-foreground shadow-sm">
            H
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold tracking-tight">{appName}</div>
            {appVersion && <div className="text-[11px] text-muted-foreground">v{appVersion}</div>}
          </div>
        </div>
        <div className="mt-3">
          <SidebarUpdateButton
            updateState={updateState}
            onCheckUpdate={onCheckUpdate}
            onDownloadUpdate={onDownloadUpdate}
            onInstallUpdate={onInstallUpdate}
            busy={busy}
          />
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-4">
        <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
          <div className="flex items-center gap-2">
            <StatusDot tone={status.tone} pulse={status.tone === "success"} />
            <span className="text-sm font-semibold">{status.label}</span>
          </div>
          {restartRequired && (
            <div className="mt-1.5 rounded-md bg-warning-soft px-2 py-1 text-[11px] font-medium text-warning">
              Restart Router to apply saved changes.
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={routerActive ? "destructive" : "secondary"}
              className="flex-1"
              onClick={() => void onToggleRouter()}
              disabled={busy === "start" || busy === "stop"}
              title={routerActive ? "Stop router" : "Start router"}
            >
              {busy === "start" || busy === "stop" ? (
                <Loader2 className="animate-spin" size={14} />
              ) : routerActive ? (
                <Square size={14} />
              ) : (
                <Play size={14} className="text-success" />
              )}
              {routerActive ? "Stop" : "Start"}
            </Button>
            {restartRequired && routerActive && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onRestartRouter()}
                disabled={busy === "restart"}
                title="Restart router"
                aria-label="Restart router"
              >
                {busy === "restart" ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarUpdateButton({
  updateState,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  busy,
}: {
  updateState: UpdateState;
  onCheckUpdate: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  busy: string;
}) {
  const isChecking = busy === "updateCheck" || updateState.status === "checking";
  const isDownloading = busy === "updateDownload" || updateState.status === "downloading";
  const isInstalling = busy === "updateInstall";
  const percent = Math.round(updateState.progress?.percent || 0);
  const downloadFailed = updateState.status === "error" && Boolean(updateState.availableVersion);

  if (!updateState.supported) {
    return null;
  }

  if (updateState.status === "downloaded") {
    return (
      <Button size="sm" className="w-full" onClick={() => void onInstallUpdate()} disabled={isInstalling} title={`Install version ${updateState.availableVersion}`}>
        {isInstalling ? <Loader2 className="animate-spin" size={13} /> : <span className="size-1.5 rounded-full bg-primary-foreground/90" />}
        Restart to update
      </Button>
    );
  }

  if (isDownloading) {
    return (
      <div className="flex h-8 items-center justify-center gap-2 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground" aria-label={`Downloading update ${percent}%`}>
        <Loader2 className="animate-spin" size={13} />
        <span>Downloading {percent}%</span>
      </div>
    );
  }

  if (isChecking) {
    return (
      <div className="flex h-8 items-center justify-center gap-2 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground" aria-label="Checking for updates">
        <Loader2 className="animate-spin" size={13} />
        <span>Checking...</span>
      </div>
    );
  }

  if (downloadFailed) {
    return (
      <Button size="sm" variant="outline" className="w-full text-destructive" onClick={() => void onDownloadUpdate()} title={updateState.error || "Update download failed"}>
        <span className="size-1.5 rounded-full bg-destructive" />
        Update failed · Retry
      </Button>
    );
  }

  if (updateState.status === "error") {
    return (
      <Button size="sm" variant="outline" className="w-full text-destructive" onClick={() => void onCheckUpdate()} title={updateState.error || "Update check failed"}>
        <RefreshCw size={13} />
        Check failed · Retry
      </Button>
    );
  }

  if (updateState.status !== "available") {
    return (
      <Button size="sm" variant="ghost" className="w-full text-muted-foreground" onClick={() => void onCheckUpdate()} title="Check for updates">
        <RefreshCw size={13} />
        Check for updates
      </Button>
    );
  }

  return (
    <Button size="sm" variant="secondary" className="w-full" onClick={() => void onDownloadUpdate()} disabled={isInstalling} title={`Download version ${updateState.availableVersion}`}>
      <span className="size-1.5 rounded-full bg-primary" />
      Update available
    </Button>
  );
}
