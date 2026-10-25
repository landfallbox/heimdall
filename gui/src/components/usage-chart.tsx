import * as React from "react";

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

// 与 grid-rows-[220px_18px] 的绘图区高度保持一致
const CHART_HEIGHT_PX = 220;
const MIN_SEGMENT_PX = 2.5;
const MIN_SEGMENT_PCT = (MIN_SEGMENT_PX / CHART_HEIGHT_PX) * 100;

interface DrawnSegment extends ChartSegment {
  heightPercent: number;
}

// 为有数据的切片应用最小保底高度，避免极端倾斜数据下小切片被舍入为 0 像素
function allocateSegmentHeights(segments: ChartSegment[], chartMaximum: number): DrawnSegment[] {
  const heights = segments.map((segment) => (segment.totalTokens > 0 ? Math.max((segment.totalTokens / chartMaximum) * 100, MIN_SEGMENT_PCT) : 0));
  const total = heights.reduce((sum, value) => sum + value, 0);
  const scale = total > 100 ? 100 / total : 1;
  return segments.map((segment, index) => ({ ...segment, heightPercent: heights[index] * scale }));
}

function usageModelSegments(day: UsageDaily, activeModels: string[], otherBaseModels: string[], otherVisible: boolean, modelColors: Map<string, string>): ChartSegment[] {
  const totals = new Map((day.models || []).map((model) => [model.name, model.totalTokens]));
  const segments: ChartSegment[] = activeModels.map((name) => ({ name, totalTokens: totals.get(name) || 0, color: modelColors.get(name) }));
  if (otherVisible) {
    // Other 始终只包含 Top5（otherBaseModels）之外的模型，避免被隐藏的 Top5 模型被误并入 Other
    segments.push({
      name: "Other",
      totalTokens: (day.models || []).reduce((sum, model) => sum + (otherBaseModels.includes(model.name) ? 0 : model.totalTokens), 0),
      color: modelColors.get("Other"),
    });
  }
  return segments;
}

export function UsageChart({ days, metric = "tokens" }: { days: UsageDaily[]; metric?: UsageChartMetric }) {
  const [hiddenModels, setHiddenModels] = React.useState<Set<string>>(() => new Set());
  const [hoveredModel, setHoveredModel] = React.useState<string | null>(null);

  const rawDailyValues = days.map((day) => (metric === "cost" ? sumCostAmount(day.costs) : day.totalTokens));
  const hasRawData = rawDailyValues.some((value) => value > 0);

  if (!hasRawData) {
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

  const isTokens = metric === "tokens";
  const activeModels = isTokens ? visibleModels.filter((name) => !hiddenModels.has(name)) : [];
  const activeModelSet = new Set(activeModels);
  // Other 桶（Top5 之外的模型）是否展示：存在其他模型且未被用户隐藏
  const otherVisible = hasOtherModels && !hiddenModels.has("Other");

  // 基于未隐藏模型重算每日合计与 Y 轴刻度，隐藏主力模型后自动缩放
  // 合计口径与实际渲染段一致：未隐藏的 Top5 模型 + Other（Top5 之外的模型）
  const dailyValues = days.map((day) => {
    if (metric === "cost") {
      return sumCostAmount(day.costs);
    }
    const models = day.models || [];
    let sum = models.reduce((acc, model) => acc + (activeModelSet.has(model.name) ? model.totalTokens : 0), 0);
    if (otherVisible) {
      sum += models.reduce((acc, model) => acc + (visibleModels.includes(model.name) ? 0 : model.totalTokens), 0);
    }
    return sum;
  });
  const chartMaximum = niceChartMaximum(Math.max(1, ...dailyValues));

  const formatTick = metric === "cost" ? formatCompactCost : formatCompactTokenCount;
  const ticks = [chartMaximum, chartMaximum * 0.75, chartMaximum * 0.5, chartMaximum * 0.25, 0];

  function toggleModel(model: string) {
    setHiddenModels((current) => {
      const next = new Set(current);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      return next;
    });
  }

  function clearHover(model: string) {
    setHoveredModel((current) => (current === model ? null : current));
  }

  return (
    <div className="flex flex-col gap-4">
      {metric === "tokens" ? (
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1.5" aria-label="Chart legend">
          {legendModels.map((model) => {
            const hidden = hiddenModels.has(model);
            return (
              <button
                key={model}
                type="button"
                aria-pressed={hidden}
                title={hidden ? `Show ${model}` : `Hide ${model}`}
                onClick={() => toggleModel(model)}
                onMouseEnter={() => setHoveredModel(model)}
                onMouseLeave={() => clearHover(model)}
                onFocus={() => setHoveredModel(model)}
                onBlur={() => clearHover(model)}
                className={cn(
                  "flex min-w-0 max-w-[180px] cursor-pointer items-center gap-1.5 rounded-sm text-[11px] text-muted-foreground outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                  hidden && "opacity-40",
                )}
              >
                <i
                  className="size-2 shrink-0 rounded-[3px] transition-colors duration-150"
                  style={
                    hidden
                      ? { background: "transparent", boxShadow: `inset 0 0 0 1.5px ${modelColors.get(model)}` }
                      : { background: modelColors.get(model) }
                  }
                />
                <span className="truncate">{model}</span>
              </button>
            );
          })}
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
                  : usageModelSegments(day, activeModels, visibleModels, otherVisible, modelColors);
              const drawnSegments = isTokens
                ? allocateSegmentHeights(segments, chartMaximum)
                : segments.map((segment) => ({ ...segment, heightPercent: (segment.totalTokens / chartMaximum) * 100 }));
              const barHeightPercent = Math.min(100, drawnSegments.reduce((sum, segment) => sum + segment.heightPercent, 0));
              return (
                <div className="group relative flex min-w-0 items-end" key={day.date}>
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] transition-[filter] group-hover:brightness-110"
                    style={{ height: `${barHeightPercent}%` }}
                  >
                    {drawnSegments.map((segment) => (
                      <i
                        key={segment.name}
                        className="w-full shrink-0 transition-opacity duration-150"
                        style={{
                          height: barHeightPercent > 0 ? `${(segment.heightPercent / barHeightPercent) * 100}%` : "0%",
                          background: segment.color,
                          opacity: hoveredModel && hoveredModel !== segment.name ? 0.35 : 1,
                        }}
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
