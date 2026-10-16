import * as React from "react";
import { FileCog, FileText, Loader2, RefreshCw, Terminal } from "lucide-react";

import { formatLogTime, parseLogRows } from "../app-model.ts";
import { cn } from "../lib/utils.ts";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardAction, CardContent, CardHeader } from "../components/ui/card.tsx";
import type { LogPage } from "../types.ts";

const toneBadgeVariant: Record<string, "muted" | "success" | "warning" | "destructive"> = {
  neutral: "muted",
  success: "success",
  warning: "warning",
  danger: "destructive",
};

interface LogsPageProps {
  logs: LogPage;
  onRefreshLogs: () => Promise<void>;
  onLoadOlderLogs: () => Promise<void>;
  onOpenLog: () => Promise<void>;
  onOpenConfig: () => Promise<void>;
  busy: string;
}

export function LogsPage({ logs, onRefreshLogs, onLoadOlderLogs, onOpenLog, onOpenConfig, busy }: LogsPageProps) {
  const rows = parseLogRows(logs.lines);

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom < 80 && logs.hasMore && busy !== "olderLogs") {
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
        <div className="truncate rounded-lg bg-muted/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground" title={logs.path}>
          {logs.path}
        </div>
        {rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">No log entries yet.</div>
        ) : (
          <div
            className="flex max-h-[calc(100vh-320px)] min-h-[200px] flex-col gap-2 overflow-y-auto rounded-xl border border-console-entry-border bg-console p-2.5"
            onScroll={handleScroll}
          >
            {rows.map((row) => (
              <article key={row.id} className="rounded-lg border border-console-entry-border bg-console-entry px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={toneBadgeVariant[row.tone] || "muted"}>{row.level}</Badge>
                  <strong className="truncate text-[13px] font-semibold">{row.event}</strong>
                  {row.time && <time className="ml-auto shrink-0 font-mono text-[11px] text-console-muted">{formatLogTime(row.time)}</time>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-console-muted">
                  {row.vendor && <span>Vendor: {row.vendor}</span>}
                  {row.model && <span>Model: {row.model}</span>}
                  {row.statusCode && <span>Status: {row.statusCode}</span>}
                  {row.elapsedMs !== undefined && <span>Elapsed: {row.elapsedMs}ms</span>}
                  {row.totalElapsedMs !== undefined && <span>Total: {row.totalElapsedMs}ms</span>}
                  {row.requestId && <span>Request: {row.requestId}</span>}
                </div>
                {row.message && <p className="mt-1.5 text-[13px] break-words whitespace-pre-wrap">{row.message}</p>}
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] font-semibold text-console-muted select-none hover:text-console-foreground">
                    Raw
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-black/20 p-2 font-mono text-[11px] leading-relaxed">{row.raw}</pre>
                </details>
              </article>
            ))}
            {logs.hasMore && (
              <div className={cn("py-2 text-center text-[11px] text-console-muted", busy === "olderLogs" && "animate-pulse")}>
                {busy === "olderLogs" ? "Loading older entries..." : "Scroll for older entries"}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
