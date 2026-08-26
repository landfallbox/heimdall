export type Tone = "neutral" | "success" | "warning" | "danger";

export interface VendorHealthModel {
  id: string;
  circuit?: { state?: string };
}

export interface VendorHealth {
  priority?: number;
  models?: VendorHealthModel[];
}

export interface HealthBody {
  model?: string;
  vendors?: VendorHealth[];
}

export interface HealthState {
  ok: boolean;
  processCount: number;
  error?: string;
  body?: HealthBody;
}

export interface LogEntry {
  id: string;
  raw: string;
  time: string;
  level: string;
  tone: Tone;
  event: string;
  vendor: string;
  statusCode?: number;
  elapsedMs?: number;
  totalElapsedMs?: number;
  model: string;
  requestId: string;
  message: string;
}

export interface LogPage {
  path: string;
  lines: string[];
  nextBefore: number | null;
  hasMore: boolean;
}

export interface UpdateState {
  status: string;
  supported: boolean;
  currentVersion: string;
  availableVersion: string;
  releaseName: string;
  releaseNotes: string;
  progress: { percent: number } | null;
  error: string;
  lastCheckedAt: string;
}

export interface UsageCost {
  currency: string;
  amount: number;
}

export interface UsagePeriod {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  usageCoverage: number;
  priceCoverage: number;
  costs: UsageCost[];
}

export interface UsageDailyModel {
  name: string;
  totalTokens: number;
}

export interface UsageDaily {
  date: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costs: UsageCost[];
  models?: UsageDailyModel[];
}

export interface UsageSummary {
  filters: {
    vendor: string;
    model: string;
    vendors: string[];
    models: string[];
  };
  periods: {
    day: UsagePeriod;
    week: UsagePeriod;
    month: UsagePeriod;
  };
  daily: UsageDaily[];
}

export interface ChartSegment {
  name: string;
  totalTokens: number;
  color: string | undefined;
}
