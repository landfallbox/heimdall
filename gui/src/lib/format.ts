export function formatTokenCount(value: number) {
  return Number(value || 0).toLocaleString();
}

export function formatCompactTokenCount(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatPlainAmount(amount: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: amount < 0.01 ? 6 : 2,
  }).format(amount);
}

function formatCostAmount(currency: string, amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: amount < 0.01 ? 6 : 2,
  }).format(amount);
}

export function formatCosts(costs: Array<{ currency: string; amount: number }> | undefined) {
  if (!Array.isArray(costs) || !costs.length) {
    return "Cost unavailable";
  }
  const withCode = costs.length > 1;
  return costs
    .map(({ currency, amount }) => (withCode ? `${currency} ${formatPlainAmount(amount)}` : formatCostAmount(currency, amount)))
    .join(" + ");
}

export function formatPeakHours(peakHours: number[][] | null | undefined) {
  if (!Array.isArray(peakHours) || !peakHours.length) {
    return "";
  }
  return `${peakHours
    .map(([start, end]) => `${String(start).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`)
    .join(", ")} UTC`;
}
