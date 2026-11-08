import * as React from "react";
import {
  ArrowDown,
  ChevronRight,
  Copy,
  FileCog,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Terminal,
  X,
} from "lucide-react";
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
import { Button } from "../components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import type { LogEntry, LogPage } from "../types.ts";

const LOG_LEVELS = ["info", "warn", "error"] as const;

/** 统一的网格列定义，表头与数据行共用，确保像素级绝对对齐 */
const TABLE_GRID_COLS = "grid grid-cols-[18px_66px_38px_minmax(180px,1fr)_120px_130px_48px_60px] items-center gap-3";

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

async function copyText(text: string, label = "Text") {
  try {
    await getDesktopApi().writeClipboard(text);
    toast.success(`Copied ${label}.`);
  } catch {
    toast.error(`Copy failed.`);
  }
}

function statusTone(statusCode: number): string {
  if (statusCode >= 500) {
    return "text-destructive font-semibold";
  }
  if (statusCode >= 400) {
    return "text-warning font-semibold";
  }
  if (statusCode >= 200 && statusCode < 300) {
    return "text-success font-semibold";
  }
  return "text-muted-foreground";
}

function formattedJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function levelAccent(level: string): { row: string; badge: string; text: string } {
  switch (level.toLowerCase()) {
    case "error":
      return {
        row: "border-l-[3px] border-l-destructive bg-destructive/[0.04] hover:bg-destructive/[0.08]",
        badge: "bg-destructive/15 text-destructive border-destructive/25",
        text: "ERR",
      };
    case "warn":
      return {
        row: "border-l-[3px] border-l-warning bg-warning/[0.04] hover:bg-warning/[0.08]",
        badge: "bg-warning/15 text-warning border-warning/25",
        text: "WRN",
      };
    case "info":
      return {
        row: "border-l-[3px] border-l-transparent hover:bg-muted/30",
        badge: "bg-muted text-muted-foreground border-border/40",
        text: "INF",
      };
    default:
      return {
        row: "border-l-[3px] border-l-transparent hover:bg-muted/30",
        badge: "bg-muted text-muted-foreground border-border/40",
        text: level.slice(0, 3).toUpperCase(),
      };
  }
}

function LogRow({ row }: { row: LogEntry }) {
  const [expanded, setExpanded] = React.useState(false);
  const accent = levelAccent(row.level);

  return (
    <article
      className={cn(
        "group flex flex-col border-b border-border/25 last:border-b-0 transition-colors select-text text-[12px] font-mono",
        accent.row,
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className={cn(
          TABLE_GRID_COLS,
          "min-h-[34px] cursor-pointer px-3 py-1.5 transition-colors focus:outline-none",
        )}
      >
        {/* 1. Chevron Icon */}
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/60 transition-transform duration-150 group-hover:text-foreground">
          <ChevronRight size={13} className={cn("transition-transform duration-150", expanded && "rotate-90 text-foreground")} />
        </span>

        {/* 2. Timestamp */}
        <time className="font-mono text-[11px] tabular-nums text-muted-foreground text-left">
          {formatLogTime(row.time) || "—"}
        </time>

        {/* 3. Level Micro-Badge */}
        <div className="flex justify-center">
          <span
            className={cn(
              "flex h-[18px] w-[34px] items-center justify-center rounded border font-mono text-[10px] font-bold tracking-wider",
              accent.badge,
            )}
          >
            {accent.text}
          </span>
        </div>

        {/* 4. Event Name & Message Preview */}
        <div className="flex min-w-0 items-baseline gap-2 overflow-hidden text-left">
          <span className="shrink-0 font-semibold text-foreground text-[12px]">{row.event}</span>
          {row.message && (
            <span
              className={cn(
                "truncate text-[11.5px] font-sans",
                row.level === "error" ? "text-destructive/90 font-medium" : row.level === "warn" ? "text-warning/90" : "text-muted-foreground",
              )}
              title={row.message}
            >
              {row.message}
            </span>
          )}
        </div>

        {/* 5. Vendor */}
        <div className="text-left overflow-hidden">
          {row.vendor ? (
            <span
              className="inline-block max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground border border-border/30"
              title={`Vendor: ${row.vendor}`}
            >
              {row.vendor}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/30">—</span>
          )}
        </div>

        {/* 6. Model */}
        <div className="text-left overflow-hidden">
          {row.model ? (
            <span
              className="inline-block max-w-full truncate font-mono text-[11px] text-foreground/80"
              title={`Model: ${row.model}`}
            >
              {row.model}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/30">—</span>
          )}
        </div>

        {/* 7. Status Code */}
        <div className="text-center font-mono text-[11px]">
          {row.statusCode !== undefined ? (
            <span className={statusTone(row.statusCode)}>{row.statusCode}</span>
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </div>

        {/* 8. Latency */}
        <div className="text-right font-mono text-[11px] text-muted-foreground">
          {row.elapsedMs !== undefined ? `${row.elapsedMs}ms` : "—"}
        </div>
      </div>

      {/* Expanded Inspection Drawer */}
      {expanded && (
        <div className="border-t border-border/30 bg-black/15 px-9 py-3 flex flex-col gap-2.5 dark:bg-black/30">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            {row.requestId ? (
              <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-background/80 px-2.5 py-1">
                <span className="font-semibold text-muted-foreground text-[10.5px]">Request ID:</span>
                <span className="font-mono text-[11px] text-foreground select-all">{row.requestId}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void copyText(row.requestId, "Request ID");
                  }}
                  className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  title="Copy Request ID"
                >
                  <Copy size={11} />
                </button>
              </div>
            ) : (
              <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                Raw JSON Payload
              </span>
            )}

            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(row.raw, "JSON");
                }}
                className="flex items-center gap-1 rounded border border-border/50 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Copy size={11} /> Copy JSON
              </button>
            </div>
          </div>

          {row.message && (
            <div
              className={cn(
                "rounded border p-2 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap",
                row.level === "error"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : row.level === "warn"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border/40 bg-background/60 text-foreground",
              )}
            >
              <strong>Message: </strong>
              {row.message}
            </div>
          )}

          <pre className="max-h-[320px] overflow-auto rounded border border-border/40 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-all shadow-inner">
            {formattedJson(row.raw)}
          </pre>
        </div>
      )}
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
  const filterActive =
    filterState.levels.length > 0 ||
    Boolean(filterState.vendor || filterState.model || filterState.keyword.trim() || filterState.timeRange !== "all");

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
      setNewCount(0);
      setStuck(true);
      scrollToBottom();
    } else if (lines.length > prev.len) {
      if (last === prev.last) {
        // loading older logs at top: keep scroll position
      } else if (stuckRef.current) {
        scrollToBottom();
      } else {
        setNewCount((count) => count + (lines.length - prev.len));
      }
    }
    prevRef.current = { len: lines.length, last };
  }, [logs.lines]);

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

  function handleResetFilters() {
    setKeywordInput("");
    onFilterChange({
      levels: [],
      vendor: "",
      model: "",
      keyword: "",
      timeRange: "all",
    });
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
    if (element.scrollTop < 80 && logs.hasMore && busy !== "olderLogs") {
      void onLoadOlderLogs();
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Terminal size={16} />
          </span>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight">Logs</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {rows.length} {rows.length === 1 ? "entry" : "entries"}
            </span>
          </div>
        </div>
        <CardAction>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onRefreshLogs()}
              disabled={busy === "logs"}
              className="h-8 gap-1.5 text-xs"
            >
              {busy === "logs" ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onOpenLog()}
              disabled={busy === "openLog"}
              className="h-8 gap-1.5 text-xs"
            >
              {busy === "openLog" ? <Loader2 className="animate-spin" size={13} /> : <FileText size={13} />}
              Open log
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onOpenConfig()}
              disabled={busy === "openConfig"}
              className="h-8 gap-1.5 text-xs"
            >
              {busy === "openConfig" ? <Loader2 className="animate-spin" size={13} /> : <FileCog size={13} />}
              Open config
            </Button>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {/* Unified Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/20 p-2">
          {/* Level Filter Segment */}
          <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background/80 p-0.5 shadow-xs">
            {LOG_LEVELS.map((level) => {
              const active = filterState.levels.includes(level);
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => toggleLevel(level)}
                  className={cn(
                    "rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                    active
                      ? level === "error"
                        ? "bg-destructive/20 text-destructive border border-destructive/30"
                        : level === "warn"
                        ? "bg-warning/20 text-warning border border-warning/30"
                        : "bg-primary/20 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {level}
                </button>
              );
            })}
          </div>

          {/* Vendor Filter */}
          <Select
            value={filterState.vendor || "all"}
            onValueChange={(value) => onFilterChange({ ...filterState, vendor: value === "all" ? "" : value })}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs bg-background/80" aria-label="Filter by vendor">
              <SelectValue placeholder="Vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendorOptions.map((vendor) => (
                <SelectItem key={vendor} value={vendor}>
                  {vendor}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Model Filter */}
          <Select
            value={filterState.model || "all"}
            onValueChange={(value) => onFilterChange({ ...filterState, model: value === "all" ? "" : value })}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs font-mono bg-background/80" aria-label="Filter by model">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models</SelectItem>
              {modelOptions.map((model) => (
                <SelectItem key={model} value={model} className="font-mono text-xs">
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Time Range Filter */}
          <Select
            value={filterState.timeRange}
            onValueChange={(value) => onFilterChange({ ...filterState, timeRange: value as LogTimeRange })}
          >
            <SelectTrigger className="h-8 w-[110px] text-xs bg-background/80" aria-label="Time range">
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              {LOG_TIME_RANGES.map((range) => (
                <SelectItem key={range.value} value={range.value} className="text-xs">
                  {range.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Search Box */}
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              placeholder="Search keyword or requestId..."
              className="h-8 w-[230px] pl-8 pr-7 text-xs bg-background/80"
            />
            {keywordInput && (
              <button
                type="button"
                onClick={() => setKeywordInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Reset Active Filters */}
          {filterActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw size={12} />
              Reset
            </Button>
          )}
        </div>

        {/* Log Stream Table Container */}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/80 py-16 text-center text-sm text-muted-foreground">
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
              {busy === "logs" ? <Loader2 className="animate-spin" size={18} /> : <Terminal size={18} />}
            </div>
            <p className="font-medium text-foreground">
              {busy === "logs"
                ? "Loading runtime logs..."
                : filterActive
                ? "No entries match the current filter."
                : "No log entries yet."}
            </p>
            {filterActive && busy !== "logs" && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-2 text-xs text-primary underline underline-offset-4 hover:opacity-80"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="relative flex flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-xs">
            {/* Table Column Headers - 与数据行共用 TABLE_GRID_COLS */}
            <div className={cn(TABLE_GRID_COLS, "border-b border-border/40 bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none")}>
              <span />
              <span className="text-left">Time</span>
              <span className="text-center">Level</span>
              <span className="text-left">Event / Message</span>
              <span className="text-left">Vendor</span>
              <span className="text-left">Model</span>
              <span className="text-center">Status</span>
              <span className="text-right">Latency</span>
            </div>

            {/* Scrollable Stream */}
            <div
              ref={listRef}
              className="flex max-h-[calc(100vh-340px)] min-h-[300px] flex-col overflow-y-auto"
              onScroll={handleScroll}
            >
              {logs.hasMore && (
                <div
                  className={cn(
                    "border-b border-border/30 bg-muted/20 py-2 text-center text-[11px] text-muted-foreground",
                    busy === "olderLogs" && "animate-pulse",
                  )}
                >
                  {busy === "olderLogs" ? "Loading older entries..." : "Scroll up for older entries"}
                </div>
              )}
              {rows.map((row) => (
                <LogRow key={row.id} row={row} />
              ))}
            </div>

            {/* Floating "N new" Jump Button */}
            {!stuck && newCount > 0 && (
              <button
                type="button"
                className="absolute right-4 bottom-4 z-10 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[11.5px] font-semibold text-primary-foreground shadow-lg backdrop-blur hover:opacity-90 animate-bounce"
                onClick={() => {
                  setNewCount(0);
                  setStuck(true);
                  scrollToBottom();
                }}
              >
                <ArrowDown size={13} />
                {newCount} new
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
