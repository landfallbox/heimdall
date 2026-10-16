import * as React from "react";
import { ChevronDown, Info, Loader2 } from "lucide-react";

import { SegmentedControl } from "../components/segmented-control.tsx";
import { UsageChart } from "../components/usage-chart.tsx";
import { formatCosts, formatTokenCount } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.tsx";
import type { UsagePeriod, UsageSummary } from "../types.ts";

type ChartMetric = "tokens" | "cost";

interface UsagePageProps {
  usage: UsageSummary | null;
  onRefreshUsage: (options?: { vendor?: string; model?: string }) => void;
  busy: string;
}

export function UsagePage({ usage, onRefreshUsage, busy }: UsagePageProps) {
  const [vendorFilter, setVendorFilter] = React.useState("");
  const [modelFilter, setModelFilter] = React.useState("");
  const [chartMetric, setChartMetric] = React.useState<ChartMetric>("tokens");

  React.useEffect(() => {
    setVendorFilter(usage?.filters?.vendor || "");
    setModelFilter(usage?.filters?.model || "");
  }, [usage?.filters?.vendor, usage?.filters?.model]);

  if (!usage) {
    return (
      <div className="flex min-h-[180px] items-center justify-center gap-2.5 rounded-xl border border-border bg-card text-sm text-muted-foreground shadow-card">
        <Loader2 className={busy === "usage" ? "animate-spin" : ""} size={18} />
        <span>{busy === "usage" ? "Loading usage..." : "No usage data loaded."}</span>
      </div>
    );
  }

  const periods: Array<[string, UsagePeriod]> = [
    ["Today", usage.periods.day],
    ["This week", usage.periods.week],
    ["This month", usage.periods.month],
  ];

  function applyFilters(vendor: string, model: string) {
    setVendorFilter(vendor);
    setModelFilter(model);
    onRefreshUsage({ vendor, model });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <UsageFilter
          label="Vendor"
          value={vendorFilter}
          options={usage.filters.vendors}
          allLabel="All vendors"
          disabled={busy === "usage"}
          onChange={(value) => applyFilters(value, modelFilter)}
        />
        <UsageFilter
          label="Model"
          value={modelFilter}
          options={usage.filters.models}
          allLabel="All models"
          disabled={busy === "usage"}
          onChange={(value) => applyFilters(vendorFilter, value)}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {periods.map(([label, period]) => (
          <UsagePeriodCard key={label} label={label} period={period} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight">Last 30 days</CardTitle>
          <SegmentedControl
            options={[
              { value: "tokens", label: "Tokens" },
              { value: "cost", label: "Cost" },
            ]}
            value={chartMetric}
            onChange={setChartMetric}
            className="w-fit"
          />
        </CardHeader>
        <CardContent>
          <UsageChart days={usage.daily} metric={chartMetric} />
        </CardContent>
      </Card>
    </div>
  );
}

function UsageFilter({
  label,
  value,
  options,
  allLabel,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  allLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex w-52 min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-input bg-card pl-3 pr-9 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <option value="">{allLabel}</option>
          {options.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div>
    </div>
  );
}

function UsagePeriodCard({ label, period }: { label: string; period: UsagePeriod }) {
  const hasCosts = period.costs.length > 0;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{label}</span>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {period.requestCount.toLocaleString()} reqs
          </span>
        </div>

        <div className="flex min-w-0 items-end justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              <i className="h-2.5 w-[3px] rounded-sm bg-primary" />
              Token usage
            </span>
            <strong className="truncate text-2xl leading-tight font-semibold tabular-nums">{formatTokenCount(period.totalTokens)}</strong>
          </div>
          <CoverageTag kind="tracked" coverage={period.usageCoverage} requestCount={period.requestCount} />
        </div>

        <div className="flex min-w-0 items-end justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              <i className="h-2.5 w-[3px] rounded-sm bg-success" />
              Est. cost
            </span>
            {hasCosts ? (
              <strong className={cn("truncate leading-tight font-semibold tabular-nums", period.costs.length > 1 ? "text-[15px]" : "text-2xl")}>
                {formatCosts(period.costs)}
              </strong>
            ) : (
              <span
                className="flex items-center gap-1.5 text-2xl leading-tight font-semibold text-muted-foreground/60"
                title="Some models have no pricing configured, so their cost is not counted."
              >
                --
                <Info size={14} className="shrink-0 text-muted-foreground/50" aria-hidden="true" />
              </span>
            )}
          </div>
          <CoverageTag kind="priced" coverage={period.priceCoverage} requestCount={period.requestCount} />
        </div>

        <div className="grid grid-cols-3 gap-3.5 border-t border-border pt-3.5">
          <Metric label="Input" value={formatTokenCount(period.inputTokens)} />
          <Metric label="Cached" value={formatTokenCount(period.cachedInputTokens)} title="Cached input tokens, a subset of input tokens billed at the cached rate." />
          <Metric label="Output" value={formatTokenCount(period.outputTokens)} />
        </div>
      </CardContent>
    </Card>
  );
}

function CoverageTag({ kind, coverage, requestCount }: { kind: "tracked" | "priced"; coverage: number; requestCount: number }) {
  if (requestCount === 0) {
    return <span className="pb-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground/60">-- {kind}</span>;
  }
  const percent = Math.round(coverage * 100);
  const partial = coverage < 1;
  return (
    <span
      className={cn("flex items-center gap-1 pb-0.5 text-[11px] font-semibold tabular-nums", partial ? "text-warning" : "text-muted-foreground")}
      title={
        kind === "tracked"
          ? "Share of requests that reported token usage. Below 100% means the token total may be an underestimate."
          : "Share of usage-known requests with a resolved price. Below 100% means some requests have no cost (e.g. model not in the selected vendor's price list)."
      }
    >
      {partial && <Info size={11} className="shrink-0" aria-hidden="true" />}
      {percent}% {kind}
    </span>
  );
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" title={title}>
      <span className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{label}</span>
      <strong className="truncate text-[13px] font-semibold tabular-nums">{value}</strong>
    </div>
  );
}
