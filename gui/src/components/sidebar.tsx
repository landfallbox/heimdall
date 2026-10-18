import { useState, type ReactNode } from "react";
import { Check, Copy, Download, Gauge, Info, Loader2, Play, RefreshCw, RotateCcw, Settings2, Server, Square, Terminal, type LucideIcon } from "lucide-react";

import appIcon from "../../../build/icon.svg";
import { getDesktopApi } from "../desktop-api.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { StatusDot, type StatusTone } from "./status-dot.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
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
  detail?: string;
}

interface SidebarProps {
  appName: string;
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
    <aside className="sidebar-root flex h-full w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <img src={appIcon} alt="" draggable={false} className="size-9 shrink-0 select-none" />
          <div className="min-w-0 truncate text-[15px] font-bold tracking-tight">{appName}</div>
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

      <div className="mt-auto flex flex-col gap-3 p-4">
        <SidebarUpdateCard
          updateState={updateState}
          onCheckUpdate={onCheckUpdate}
          onDownloadUpdate={onDownloadUpdate}
          onInstallUpdate={onInstallUpdate}
          busy={busy}
        />
        <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
          <div className="flex items-center gap-2">
            <StatusDot tone={status.tone} pulse={status.tone === "success"} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{status.label}</span>
            {status.detail && <StatusDetailPopover detail={status.detail} />}
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

/** 侧边栏底部更新通知卡片：检查中、检查失败或有更新时显示，平时不占位 */
function SidebarUpdateCard({
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

  let card: ReactNode;

  if (updateState.status === "downloaded") {
    card = (
      <div className="rounded-xl border border-primary/40 bg-gradient-to-b from-primary/15 to-primary/5 p-3 shadow-card">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="text-sm font-semibold">Update ready</span>
        </div>
        <VersionTransition current={updateState.currentVersion} next={updateState.availableVersion} />
        <Button size="sm" className="mt-2.5 w-full" onClick={() => void onInstallUpdate()} disabled={isInstalling} title={`Install version ${updateState.availableVersion}`}>
          {isInstalling ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
          {isInstalling ? "Installing..." : "Restart to update"}
        </Button>
      </div>
    );
  } else if (isDownloading) {
    card = (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3" aria-label={`Downloading update ${percent}%`}>
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Loader2 className="animate-spin size-3.5 shrink-0" />
          <span className="min-w-0 truncate">Downloading {percent}%</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-primary/15">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  } else if (isChecking) {
    card = (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3" aria-label="Checking for updates">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Loader2 className="animate-spin size-3.5 shrink-0" />
          <span className="min-w-0 truncate">Checking for updates...</span>
        </div>
      </div>
    );
  } else if (downloadFailed) {
    card = (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
          <span className="min-w-0 truncate text-sm font-semibold" title={updateState.error || "Update download failed"}>
            Update failed
          </span>
        </div>
        <Button size="sm" variant="outline" className="mt-2.5 w-full text-destructive" onClick={() => void onDownloadUpdate()} title={updateState.error || "Update download failed"}>
          <RefreshCw size={14} />
          Retry download
        </Button>
      </div>
    );
  } else if (updateState.status === "error") {
    card = (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
          <span className="min-w-0 truncate text-sm font-semibold" title={updateState.error || "Update check failed"}>
            Update check failed
          </span>
        </div>
        <Button size="sm" variant="outline" className="mt-2.5 w-full text-destructive" onClick={() => void onCheckUpdate()} title={updateState.error || "Update check failed"}>
          <RefreshCw size={14} />
          Retry check
        </Button>
      </div>
    );
  } else if (updateState.status === "available") {
    card = (
      <div className="rounded-xl border border-primary/40 bg-gradient-to-b from-primary/15 to-primary/5 p-3 shadow-card">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="text-sm font-semibold">Update available</span>
        </div>
        <VersionTransition current={updateState.currentVersion} next={updateState.availableVersion} />
        <Button size="sm" className="mt-2.5 w-full" onClick={() => void onDownloadUpdate()} disabled={isInstalling} title={`Download version ${updateState.availableVersion}`}>
          <Download size={14} />
          Update now
        </Button>
      </div>
    );
  }

  // 读屏播报与卡片分支同序；下载中保持静默（进度持续变化，避免噪音）
  const liveMessage = updateState.status === "downloaded"
    ? "Update ready"
    : isDownloading
      ? ""
      : isChecking
        ? "Checking for updates..."
        : downloadFailed
          ? "Update download failed"
          : updateState.status === "error"
            ? "Update check failed"
            : updateState.status === "available"
              ? "Update available"
              : "";

  return (
    <>
      {card}
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
    </>
  );
}

/** 等宽小字展示版本演进：v0.15.0 → v0.16.0，缺失侧用占位符兜底 */
function VersionTransition({ current, next }: { current: string; next: string }) {
  const from = current ? `v${current}` : "…";
  const to = next ? `v${next}` : "…";
  return (
    <div className="mt-1 flex items-center gap-1.5 overflow-hidden px-3.5 font-mono text-[11px] text-muted-foreground">
      <span className="shrink-0">{from}</span>
      <span className="shrink-0 text-muted-foreground/50">→</span>
      <span className="min-w-0 truncate font-medium text-foreground/80">{to}</span>
    </div>
  );
}

function StatusDetailPopover({ detail }: { detail: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await getDesktopApi().writeClipboard(detail);
    } catch {
      await navigator.clipboard.writeText(detail);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Show status details"
          title="Show status details"
        >
          <Info size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="text-xs font-semibold">Status details</p>
        <p className="mt-1.5 max-h-32 overflow-y-auto break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void copy()}>
          {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy error"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
