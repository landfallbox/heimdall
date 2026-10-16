import { formatCompactTokenCount, formatCosts, formatTokenCount } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import type { ChartSegment, UsageCost, UsageDaily } from "../types.ts";

export type UsageChartMetric = "tokens" | "cost";

function sumCostAmount(costs: UsageCost[] | undefined) {
  return (costs || []).reduce((sum, cost) => sum + cost.amount, 0);
}

function formatCompactCost(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  }).format(value);
}

function usageModelColor(index: number, model: string) {
  if (model === "Other") {
    return "var(--chart-other)";
  }
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
  return colors[index % colors.length];
}

function niceChartMaximum(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
}

function usageModelSegments(day: UsageDaily, visibleModels: string[], hasOtherModels: boolean, modelColors: Map<string, string>): ChartSegment[] {
  const totals = new Map((day.models || []).map((model) => [model.name, model.totalTokens]));
  const segments: ChartSegment[] = visibleModels.map((name) => ({ name, totalTokens: totals.get(name) || 0, color: modelColors.get(name) }));
  if (hasOtherModels) {
    segments.push({
      name: "Other",
      totalTokens: (day.models || []).reduce((sum, model) => sum + (visibleModels.includes(model.name) ? 0 : model.totalTokens), 0),
      color: modelColors.get("Other"),
    });
  }
  return segments;
}

export function UsageChart({ days, metric = "tokens" }: { days: UsageDaily[]; metric?: UsageChartMetric }) {
  const dailyValues = days.map((day) => (metric === "cost" ? sumCostAmount(day.costs) : day.totalTokens));
  const chartMaximum = niceChartMaximum(Math.max(1, ...dailyValues));
  const hasData = dailyValues.some((value) => value > 0);

  if (!hasData) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        {metric === "cost" ? "No cost recorded in the last 30 days." : "No usage recorded in the last 30 days."}
      </div>
    );
  }

  const modelTotals = new Map<string, number>();
  for (const day of days) {
    for (const model of day.models || []) {
      modelTotals.set(model.name, (modelTotals.get(model.name) || 0) + model.totalTokens);
    }
  }
  const rankedModels = [...modelTotals.entries()]
    .filter(([, total]) => total > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const visibleModels = rankedModels.slice(0, 5).map(([name]) => name);
  const hasOtherModels = rankedModels.length > visibleModels.length;
  const legendModels = [...visibleModels, ...(hasOtherModels ? ["Other"] : [])];
  const modelColors = new Map(legendModels.map((name, index) => [name, usageModelColor(index, name)]));
  const formatTick = metric === "cost" ? formatCompactCost : formatCompactTokenCount;
  const ticks = [chartMaximum, chartMaximum * 0.75, chartMaximum * 0.5, chartMaximum * 0.25, 0];

  return (
    <div className="flex flex-col gap-4">
      {metric === "tokens" ? (
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1.5" aria-label="Chart legend">
          {legendModels.map((model) => (
            <span key={model} className="flex min-w-0 max-w-[180px] items-center gap-1.5 text-[11px] text-muted-foreground" title={model}>
              <i className="size-2 shrink-0 rounded-[3px]" style={{ background: modelColors.get(model) }} />
              <span className="truncate">{model}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground" aria-label="Chart legend">
          <i className="size-2 shrink-0 rounded-[3px]" style={{ background: "var(--chart-1)" }} />
          <span>Estimated cost (USD)</span>
        </div>
      )}

      <div className="grid grid-cols-[52px_minmax(0,1fr)] grid-rows-[220px_18px] gap-y-1.5 gap-x-2.5">
        <div className="flex flex-col justify-between text-right text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{formatTick(tick)}</span>
          ))}
        </div>

        <div className="relative min-w-0" aria-label={metric === "cost" ? "Estimated cost for the last 30 days" : "Token usage for the last 30 days"}>
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} className="w-full border-t border-border/70" />
            ))}
          </div>
          <div className="absolute inset-0 z-[1] grid grid-cols-[repeat(30,minmax(4px,1fr))] gap-1">
            {days.map((day, index) => {
              const segments =
                metric === "cost"
                  ? [{ name: "Estimated cost", totalTokens: sumCostAmount(day.costs), color: "var(--chart-1)" }]
                  : usageModelSegments(day, visibleModels, hasOtherModels, modelColors);
              return (
                <div className="group relative flex min-w-0 items-end" key={day.date}>
                  <div className="flex h-full w-full flex-col-reverse transition-[filter] group-hover:brightness-110">
                    {segments.map((segment) => (
                      <i
                        key={segment.name}
                        className="min-h-0 w-full rounded-[2px]"
                        style={
                          {
                            height: `${(segment.totalTokens / chartMaximum) * 100}%`,
                            background: segment.color,
                          } as React.CSSProperties
                        }
                      />
                    ))}
                  </div>
                  <UsageChartTooltip day={day} segments={segments} metric={metric} edge={index < 3 ? "start" : index > days.length - 4 ? "end" : ""} />
                </div>
              );
            })}
          </div>
        </div>

        <div aria-hidden="true" />
        <div className="grid grid-cols-[repeat(30,minmax(4px,1fr))] gap-1 text-[10px] text-muted-foreground" aria-hidden="true">
          {days.map((day, index) => (
            <span key={day.date} className="whitespace-nowrap">
              {index === 0 || index === days.length - 1 || index % 7 === 0 ? day.date.slice(5) : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function UsageChartTooltip({ day, segments, metric = "tokens", edge }: { day: UsageDaily; segments: ChartSegment[]; metric?: UsageChartMetric; edge: string }) {
  return (
    <div
      className={cn(
        "absolute top-2 left-1/2 z-[4] hidden w-56 -translate-x-1/2 flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-float group-hover:flex",
        edge === "start" && "left-0 translate-x-0",
        edge === "end" && "right-0 left-auto translate-x-0",
      )}
    >
      <strong className="text-xs font-semibold">{day.date}</strong>
      <dl className="grid gap-1.5">
        {metric === "cost" ? (
          <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2.5">
            <dt className="text-[11px] text-muted-foreground">Est. cost</dt>
            <dd className="text-[11px] tabular-nums">{formatCosts(day.costs)}</dd>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2.5">
              <dt className="text-[11px] text-muted-foreground">Total tokens</dt>
              <dd className="text-[11px] tabular-nums">{formatTokenCount(day.totalTokens)}</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2.5">
              <dt className="text-[11px] text-muted-foreground">Input</dt>
              <dd className="text-[11px] tabular-nums">{formatTokenCount(day.inputTokens)}</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2.5">
              <dt className="text-[11px] text-muted-foreground">Output</dt>
              <dd className="text-[11px] tabular-nums">{formatTokenCount(day.outputTokens)}</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2.5">
              <dt className="text-[11px] text-muted-foreground">Est. cost</dt>
              <dd className="text-[11px] tabular-nums">{formatCosts(day.costs)}</dd>
            </div>
          </>
        )}
      </dl>
      {metric === "tokens" && segments.length > 1 && (
        <div className="grid gap-1.5 border-t border-border pt-2">
          {segments
            .filter((segment) => segment.totalTokens > 0)
            .map((segment) => (
              <span key={segment.name} className="grid grid-cols-[8px_minmax(0,1fr)_max-content] items-center gap-2 text-[11px] text-muted-foreground">
                <i className="size-2 rounded-[3px]" style={{ background: segment.color }} />
                <b className="truncate font-semibold text-foreground" title={segment.name}>
                  {segment.name}
                </b>
                <span className="tabular-nums">{formatTokenCount(segment.totalTokens)}</span>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

export { usageModelSegments };
