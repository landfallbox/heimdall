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

// 峰谷窗口以 UTC 小时定义，展示时换算为用户本地时区（兼容半小时偏移）。
export function formatPeakHours(peakHours: number[][] | null | undefined, now: Date = new Date()) {
  if (!Array.isArray(peakHours) || !peakHours.length) {
    return "";
  }
  const offsetMinutes = -now.getTimezoneOffset();
  const formatHour = (utcHour: number) => {
    const total = (((utcHour * 60 + offsetMinutes) % 1440) + 1440) % 1440;
    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return mm === "00" ? `${hh}:00` : `${hh}:${mm}`;
  };
  return peakHours.map(([start, end]) => `${formatHour(start)}–${formatHour(end)}`).join(", ");
}
