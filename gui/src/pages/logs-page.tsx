import * as React from "react";
import { ArrowDown, FileCog, FileText, Loader2, RefreshCw, Terminal } from "lucide-react";
import { toast } from "sonner";

import {
  formatLogTime,
  LOG_TIME_RANGES,
  parseLogRows,
  type LogTimeRange,
  type LogsFilterState,
} from "../app-model.ts";
import { getDesktopApi } from "../desktop-api.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import type { LogEntry, LogPage } from "../types.ts";

const LOG_LEVELS = ["info", "warn", "error"] as const;

const toneBadgeVariant: Record<string, "muted" | "success" | "warning" | "destructive"> = {
  neutral: "muted",
  success: "success",
  warning: "warning",
  danger: "destructive",
};

// 级别视觉层级：error 红 / warn 琥珀 / info 中性 / 其余弱化
const levelRowAccent: Record<string, string> = {
  error: "border-l-2 border-l-destructive bg-destructive/6",
  warn: "border-l-2 border-l-warning bg-warning-soft/50",
  info: "border-l-2 border-l-transparent",
};

interface LogsPageProps {
  logs: LogPage;
  onRefreshLogs: () => Promise<void>;
  onLoadOlderLogs: () => Promise<void>;
  onOpenLog: () => Promise<void>;
  onOpenConfig: () => Promise<void>;
  busy: string;
  filterState: LogsFilterState;
  onFilterChange: (next: LogsFilterState) => void;
  vendorOptions: string[];
  modelOptions: string[];
}

async function copyText(text: string) {
  try {
    await getDesktopApi().writeClipboard(text);
    toast.success("Copied to clipboard.");
  } catch {
    toast.error("Copy failed.");
  }
}

function statusTone(statusCode: number): string {
  if (statusCode >= 500) {
    return "text-destructive";
  }
  if (statusCode >= 400) {
    return "text-warning";
  }
  return "text-success";
}

function LogRow({ row }: { row: LogEntry }) {
  return (
    <article className={cn("rounded-md border border-console-entry-border bg-console-entry px-2.5 py-1.5", levelRowAccent[row.level] || "border-l-2 border-l-transparent")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
        <time className="shrink-0 font-mono text-[11px] tabular-nums text-console-muted">{formatLogTime(row.time)}</time>
        <Badge variant={toneBadgeVariant[row.tone] || "muted"} className="shrink-0 px-1.5 text-[10px]">
          {row.level}
        </Badge>
        <strong className="shrink-0 font-semibold">{row.event}</strong>
        <span className="ml-auto flex min-w-0 items-center gap-3 font-mono text-[11px] text-console-muted">
          {row.vendor && <span className="shrink-0">{row.vendor}</span>}
          {row.model && <span className="shrink-0">{row.model}</span>}
          {row.statusCode !== undefined && <span className={cn("shrink-0", statusTone(row.statusCode))}>{row.statusCode}</span>}
          {row.elapsedMs !== undefined && <span className="shrink-0">{row.elapsedMs}ms</span>}
          {row.requestId && (
            <button
              type="button"
              className="max-w-[140px] shrink-0 truncate underline decoration-dotted underline-offset-2 hover:text-console-foreground"
              title={`Copy ${row.requestId}`}
              onClick={() => void copyText(row.requestId)}
            >
              {row.requestId}
            </button>
          )}
        </span>
      </div>
      {row.message && <p className="mt-1 text-[12px] break-words whitespace-pre-wrap text-console-foreground/80">{row.message}</p>}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] font-semibold text-console-muted select-none hover:text-console-foreground">
          Raw
        </summary>
        <pre className="mt-1 overflow-x-auto rounded-md bg-black/20 p-2 font-mono text-[11px] leading-relaxed">{row.raw}</pre>
      </details>
    </article>
  );
}

export function LogsPage({
  logs,
  onRefreshLogs,
  onLoadOlderLogs,
  onOpenLog,
  onOpenConfig,
  busy,
  filterState,
  onFilterChange,
  vendorOptions,
  modelOptions,
}: LogsPageProps) {
  const [keywordInput, setKeywordInput] = React.useState(filterState.keyword);
  const rows = React.useMemo(() => parseLogRows(logs.lines), [logs.lines]);
  const filterActive = filterState.levels.length > 0 || Boolean(filterState.vendor || filterState.model || filterState.keyword.trim());

  // 自动跟随：默认贴底滚动；用户向上滚动时暂停，滚回底部恢复；翻看期间新行计数并显示跳转按钮
  const listRef = React.useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = React.useState(true);
  const stuckRef = React.useRef(true);
  const [newCount, setNewCount] = React.useState(0);
  const prevRef = React.useRef<{ len: number; last: string | undefined }>({ len: 0, last: undefined });
  stuckRef.current = stuck;

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const element = listRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  React.useEffect(() => {
    const lines = logs.lines;
    const prev = prevRef.current;
    const last = lines[lines.length - 1];
    if (lines.length < prev.len || (lines.length === prev.len && last !== prev.last)) {
      // 刷新/过滤重置：跳到最新
      setNewCount(0);
      setStuck(true);
      scrollToBottom();
    } else if (lines.length > prev.len) {
      if (last === prev.last) {
        // 顶部前置旧行（加载更多）：保持当前阅读位置
      } else if (stuckRef.current) {
        scrollToBottom();
      } else {
        setNewCount((count) => count + (lines.length - prev.len));
      }
    }
    prevRef.current = { len: lines.length, last };
  }, [logs.lines]);

  // 关键词输入防抖后再触发服务端重读
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (keywordInput !== filterState.keyword) {
        onFilterChange({ ...filterState, keyword: keywordInput });
      }
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordInput]);

  function toggleLevel(level: string) {
    const levels = filterState.levels.includes(level)
      ? filterState.levels.filter((item) => item !== level)
      : [...filterState.levels, level];
    onFilterChange({ ...filterState, levels });
  }

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const nowStuck = distanceFromBottom < 80;
    if (nowStuck !== stuck) {
      setStuck(nowStuck);
    }
    if (nowStuck) {
      setNewCount(0);
    }
    // 时间序列表：旧行在顶部，滚到顶部加载更早的条目
    if (element.scrollTop < 80 && logs.hasMore && busy !== "olderLogs") {
      void onLoadOlderLogs();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Terminal size={16} />
          </span>
          <h2 className="text-[15px] font-semibold tracking-tight">Logs</h2>
        </div>
        <CardAction>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void onRefreshLogs()} disabled={busy === "logs"}>
              {busy === "logs" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => void onOpenLog()} disabled={busy === "openLog"}>
              {busy === "openLog" ? <Loader2 className="animate-spin" size={14} /> : <FileText size={14} />}
              Open log
            </Button>
            <Button variant="outline" size="sm" onClick={() => void onOpenConfig()} disabled={busy === "openConfig"}>
              {busy === "openConfig" ? <Loader2 className="animate-spin" size={14} /> : <FileCog size={14} />}
              Open config
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border p-0.5">
            {LOG_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => toggleLevel(level)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize",
                  filterState.levels.includes(level) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {level}
              </button>
            ))}
          </div>
          <Select
            value={filterState.vendor || "all"}
            onValueChange={(value) => onFilterChange({ ...filterState, vendor: value === "all" ? "" : value })}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Filter by vendor">
              <SelectValue placeholder="Vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendorOptions.map((vendor) => (
                <SelectItem key={vendor} value={vendor}>{vendor}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filterState.model || "all"}
            onValueChange={(value) => onFilterChange({ ...filterState, model: value === "all" ? "" : value })}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Filter by model">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models</SelectItem>
              {modelOptions.map((model) => (
                <SelectItem key={model} value={model} className="font-mono">{model}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filterState.timeRange}
            onValueChange={(value) => onFilterChange({ ...filterState, timeRange: value as LogTimeRange })}
          >
            <SelectTrigger className="h-8 w-[120px] text-xs" aria-label="Time range">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              {LOG_TIME_RANGES.map((range) => (
                <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            placeholder="Search keyword or requestId..."
            className="h-8 w-[210px] text-xs"
          />
        </div>
        {rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">
            {busy === "logs" ? "Loading logs..." : filterActive ? "No entries match the current filter." : "No log entries yet."}
          </div>
        ) : (
          <div className="relative">
            <div
              ref={listRef}
              className="flex max-h-[calc(100vh-360px)] min-h-[200px] flex-col gap-1 overflow-y-auto rounded-xl border border-console-entry-border bg-console p-2"
              onScroll={handleScroll}
            >
              {logs.hasMore && (
                <div className={cn("py-1.5 text-center text-[11px] text-console-muted", busy === "olderLogs" && "animate-pulse")}>
                  {busy === "olderLogs" ? "Loading older entries..." : "Scroll up for older entries"}
                </div>
              )}
              {rows.map((row) => (
                <LogRow key={row.id} row={row} />
              ))}
            </div>
            {!stuck && newCount > 0 && (
              <button
                type="button"
                className="absolute right-3 bottom-3 z-10 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-md hover:opacity-90"
                onClick={() => {
                  setNewCount(0);
                  setStuck(true);
                  scrollToBottom();
                }}
              >
                <ArrowDown size={12} />
                {newCount} new
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
