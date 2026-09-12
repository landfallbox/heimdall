import fs from "node:fs/promises";
import { join } from "node:path";

const USAGE_DIRECTORY = "usage";
const FILE_VERSION = 1;

export type UsageCost = {
  amount: number;
  currency: string;
  pricing: unknown;
} | null;

export type UsageEvent = {
  version: number;
  time: string;
  requestId: string;
  vendor: string;
  model: string;
  format: "chat-completions" | "responses";
  stream: boolean;
  usageKnown: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  cost: UsageCost;
};

export type UsageStore = {
  directory: string;
  record: (event: any) => Promise<void>;
  close: () => Promise<void>;
};

export function createUsageStore(runtimeRoot: string, { onError = () => {} }: { onError?: (error: Error, entry: UsageEvent) => void } = {}): UsageStore {
  const directory = join(runtimeRoot, USAGE_DIRECTORY);
  let writeQueue: Promise<void> = Promise.resolve();

  function record(event: any): Promise<void> {
    const entry = normalizeEvent(event);
    const operation = writeQueue.then(async () => {
      await fs.mkdir(directory, { recursive: true });
      await fs.appendFile(join(directory, `${entry.time.slice(0, 7)}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8");
    });
    writeQueue = operation.catch((error) => onError(error, entry));
    return operation;
  }

  return {
    directory,
    record,
    close: () => writeQueue,
  };
}

export async function readUsageSummary(runtimeRoot: string, { now = new Date(), vendor = "", model = "" }: { now?: Date; vendor?: string; model?: string } = {}) {
  const currentTime = validDate(now);
  const vendorFilter = String(vendor || "").trim();
  const modelFilter = String(model || "").trim();
  const dayStart = startOfDay(currentTime);
  const weekStart = startOfWeek(currentTime);
  const monthStart = startOfMonth(currentTime);
  const trendStart = startOfDay(addDays(currentTime, -29));
  const rangeStart = new Date(Math.min(monthStart.getTime(), trendStart.getTime()));
  const { events: allEvents, ignoredLines } = await readEvents(join(runtimeRoot, USAGE_DIRECTORY), rangeStart, currentTime);
  const events = allEvents.filter((event) => (
    (!vendorFilter || String(event.vendor || "Unknown vendor") === vendorFilter)
    && (!modelFilter || String(event.model || "Unknown model") === modelFilter)
  ));
  const periods = {
    day: createAggregate(dayStart),
    week: createAggregate(weekStart),
    month: createAggregate(monthStart),
  };
  const dailyMap = new Map<string, Aggregate>();
  const dailyModels = new Map<string, Map<string, Aggregate>>();

  for (let offset = 0; offset < 30; offset += 1) {
    const date = addDays(trendStart, offset);
    const dateKey = localDateKey(date);
    dailyMap.set(dateKey, createAggregate(startOfDay(date)));
    dailyModels.set(dateKey, new Map());
  }

  const vendors = new Map<string, Aggregate>();
  const models = new Map<string, Aggregate>();
  for (const event of events) {
    const eventTime = new Date(event.time);
    for (const [name, period] of Object.entries(periods)) {
      if (eventTime >= period.startDate) {
        addEvent(period, event);
      }
      if (name === "month" && eventTime >= monthStart) {
        addGroupedEvent(vendors, event.vendor || "Unknown vendor", event);
        addGroupedEvent(models, event.model || "Unknown model", event);
      }
    }

    const daily = dailyMap.get(localDateKey(eventTime));
    if (daily) {
      addEvent(daily, event);
      addGroupedEvent(dailyModels.get(localDateKey(eventTime)), event.model || "Unknown model", event);
    }
  }

  return {
    generatedAt: currentTime.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    ignoredLines,
    filters: {
      vendor: vendorFilter,
      model: modelFilter,
      vendors: uniqueDimensionValues(allEvents, "vendor", "Unknown vendor"),
      models: uniqueDimensionValues(allEvents, "model", "Unknown model"),
    },
    periods: Object.fromEntries(Object.entries(periods).map(([name, period]) => [name, finalizeAggregate(period)])),
    daily: [...dailyMap.entries()].map(([date, aggregate]) => ({
      date,
      ...finalizeAggregate(aggregate),
      models: finalizeGroups(dailyModels.get(date)),
    })),
    vendors: finalizeGroups(vendors),
    models: finalizeGroups(models),
  };
}

function normalizeEvent(event: any): UsageEvent {
  const time = validDate(event?.time || new Date()).toISOString();
  const usage = event?.usage;
  const cost = event?.cost;
  return {
    version: FILE_VERSION,
    time,
    requestId: String(event?.requestId || ""),
    vendor: String(event?.vendor || ""),
    model: String(event?.model || ""),
    format: event?.format === "responses" ? "responses" : "chat-completions",
    stream: event?.stream === true,
    usageKnown: Boolean(usage),
    inputTokens: tokenCount(usage?.inputTokens),
    cachedInputTokens: tokenCount(usage?.cachedInputTokens),
    outputTokens: tokenCount(usage?.outputTokens),
    reasoningTokens: tokenCount(usage?.reasoningTokens),
    totalTokens: tokenCount(usage?.totalTokens),
    cost: normalizeCost(cost),
  };
}

function normalizeCost(value: any): UsageCost {
  const amount = Number(value?.amount);
  const currency = String(value?.currency || "").trim().toUpperCase();
  if (!Number.isFinite(amount) || amount < 0 || !currency) {
    return null;
  }
  return {
    amount,
    currency,
    pricing: value.pricing && typeof value.pricing === "object" ? value.pricing : null,
  };
}

async function readEvents(directory: string, start: Date, end: Date): Promise<{ events: any[]; ignoredLines: number }> {
  const events: any[] = [];
  let ignoredLines = 0;
  const monthKeys = utcMonthKeys(start, end);
  const contents = await Promise.all(monthKeys.map(async (monthKey) => {
    try {
      return await fs.readFile(join(directory, `${monthKey}.jsonl`), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }));

  for (const content of contents) {
    for (const line of content.split(/\r?\n/).filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        const time = new Date(event?.time);
        if (!Number.isNaN(time.getTime()) && time >= start && time <= end) {
          events.push(event);
        }
      } catch {
        ignoredLines += 1;
      }
    }
  }
  return { events, ignoredLines };
}

interface Aggregate {
  startDate: Date;
  requestCount: number;
  usageKnownCount: number;
  pricedRequestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costByCurrency: Map<string, number>;
}

function createAggregate(startDate: Date): Aggregate {
  return {
    startDate,
    requestCount: 0,
    usageKnownCount: 0,
    pricedRequestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costByCurrency: new Map(),
  };
}

function addEvent(aggregate: Aggregate, event: any) {
  aggregate.requestCount += 1;
  if (event.usageKnown === true) {
    aggregate.usageKnownCount += 1;
    aggregate.inputTokens += tokenCount(event.inputTokens);
    aggregate.cachedInputTokens += tokenCount(event.cachedInputTokens);
    aggregate.outputTokens += tokenCount(event.outputTokens);
    aggregate.reasoningTokens += tokenCount(event.reasoningTokens);
    aggregate.totalTokens += tokenCount(event.totalTokens);
  }
  if (event.cost && Number.isFinite(Number(event.cost.amount)) && event.cost.currency) {
    aggregate.pricedRequestCount += 1;
    const currency = String(event.cost.currency).toUpperCase();
    aggregate.costByCurrency.set(currency, (aggregate.costByCurrency.get(currency) || 0) + Number(event.cost.amount));
  }
}

function addGroupedEvent(groups: Map<string, Aggregate> | undefined, key: string, event: any) {
  if (!groups) {
    return;
  }
  let aggregate = groups.get(key);
  if (!aggregate) {
    aggregate = createAggregate(startOfMonth(new Date(event.time)));
    groups.set(key, aggregate);
  }
  addEvent(aggregate, event);
}

function finalizeAggregate(aggregate: Aggregate) {
  return {
    startsAt: aggregate.startDate.toISOString(),
    requestCount: aggregate.requestCount,
    usageKnownCount: aggregate.usageKnownCount,
    usageCoverage: coverage(aggregate.usageKnownCount, aggregate.requestCount),
    pricedRequestCount: aggregate.pricedRequestCount,
    priceCoverage: coverage(aggregate.pricedRequestCount, aggregate.usageKnownCount),
    inputTokens: aggregate.inputTokens,
    cachedInputTokens: aggregate.cachedInputTokens,
    outputTokens: aggregate.outputTokens,
    reasoningTokens: aggregate.reasoningTokens,
    totalTokens: aggregate.totalTokens,
    costs: [...aggregate.costByCurrency.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => ({ currency, amount: Number(amount.toFixed(12)) })),
  };
}

function finalizeGroups(groups: Map<string, Aggregate> | undefined) {
  if (!groups) {
    return [];
  }
  return [...groups.entries()]
    .map(([name, aggregate]) => ({ name, ...finalizeAggregate(aggregate) }))
    .sort((left, right) => right.totalTokens - left.totalTokens || left.name.localeCompare(right.name));
}

function coverage(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : 1;
}

function utcMonthKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    keys.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function localDateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function tokenCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function validDate(value: unknown): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Usage event time must be a valid date.");
  }
  return date;
}

function uniqueDimensionValues(events: any[], field: string, fallback: string): string[] {
  return [...new Set(events.map((event) => String(event?.[field] || fallback)))].sort((left, right) => left.localeCompare(right));
}
