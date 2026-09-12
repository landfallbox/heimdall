export type CircuitBreakerOptions = {
  failureThreshold?: number;
  baseEjectionMs?: number;
  maxEjectionMs?: number;
  now?: () => number;
};

export type CircuitState = {
  consecutiveFailures: number;
  ejectionCount: number;
  openUntil: number;
  probeInFlight: boolean;
};

export type CircuitPermission = {
  key: string;
  probe: boolean;
  forced: boolean;
};

export type CircuitCandidate<T> = {
  vendor: T;
  forced: boolean;
};

export type CircuitSnapshot = {
  state: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  ejectionCount: number;
  retryAt: string;
  probeInFlight: boolean;
};

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS = Object.freeze({
  failureThreshold: 2,
  baseEjectionMs: 10_000,
  maxEjectionMs: 60_000,
});

export class VendorCircuitBreaker {
  options: { failureThreshold: number; baseEjectionMs: number; maxEjectionMs: number };
  now: () => number;
  states: Map<string, CircuitState>;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      ...DEFAULT_CIRCUIT_BREAKER_OPTIONS,
      ...options,
    };
    this.now = options.now || Date.now;
    this.states = new Map();
  }

  candidates<T extends { name?: string; baseUrl?: string; priority?: number }>(vendors: T[], modelId: string): CircuitCandidate<T>[] {
    const now = this.now();
    const available = vendors
      .filter((vendor) => this.#isAvailable(vendor, modelId, now))
      .map((vendor) => ({ vendor, forced: false }));

    if (available.length) {
      return available;
    }

    const forced = vendors
      .map((vendor, index) => ({ vendor, index, state: this.#getState(vendor, modelId) }))
      .filter(({ state }) => state.openUntil > 0)
      .sort((left, right) => left.state.openUntil - right.state.openUntil || left.index - right.index)[0];

    return forced && !forced.state.probeInFlight ? [{ vendor: forced.vendor, forced: true }] : [];
  }

  acquire(vendor: { name?: string; baseUrl?: string; priority?: number }, modelId: string, { forced = false }: { forced?: boolean } = {}): CircuitPermission | null {
    const state = this.#getState(vendor, modelId);
    const now = this.now();

    if (state.openUntil === 0) {
      return { key: this.#key(vendor, modelId), probe: false, forced: false };
    }
    if (state.probeInFlight || (state.openUntil > now && !forced)) {
      return null;
    }

    state.probeInFlight = true;
    return { key: this.#key(vendor, modelId), probe: true, forced };
  }

  recordFailure(permission: CircuitPermission): { opened: boolean; consecutiveFailures?: number; durationMs?: number; ejectionCount?: number; retryAt?: string } {
    const state = this.states.get(permission.key);
    if (!state) {
      return { opened: false };
    }

    state.probeInFlight = false;
    state.consecutiveFailures += 1;
    if (!permission.probe && state.consecutiveFailures < this.options.failureThreshold) {
      return { opened: false, consecutiveFailures: state.consecutiveFailures };
    }

    state.ejectionCount += 1;
    state.consecutiveFailures = 0;
    const durationMs = Math.min(
      this.options.baseEjectionMs * state.ejectionCount,
      this.options.maxEjectionMs,
    );
    state.openUntil = this.now() + durationMs;

    return {
      opened: true,
      durationMs,
      ejectionCount: state.ejectionCount,
      retryAt: new Date(state.openUntil).toISOString(),
    };
  }

  recordSuccess(permission: CircuitPermission): { closed: boolean; ejectionCount?: number } {
    const state = this.states.get(permission.key);
    if (!state) {
      return { closed: false };
    }

    const wasOpen = state.openUntil > 0;
    state.consecutiveFailures = 0;
    state.openUntil = 0;
    state.probeInFlight = false;
    state.ejectionCount = Math.max(0, state.ejectionCount - 1);
    return { closed: wasOpen, ejectionCount: state.ejectionCount };
  }

  release(permission: CircuitPermission) {
    const state = this.states.get(permission.key);
    if (state && permission.probe) {
      state.probeInFlight = false;
    }
  }

  snapshot(vendor: { name?: string; baseUrl?: string; priority?: number }, modelId: string): CircuitSnapshot {
    const state = this.#getState(vendor, modelId);
    const now = this.now();
    const status = state.openUntil === 0
      ? "closed"
      : state.openUntil > now
        ? "open"
        : "half-open";

    return {
      state: status,
      consecutiveFailures: state.consecutiveFailures,
      ejectionCount: state.ejectionCount,
      retryAt: status === "open" ? new Date(state.openUntil).toISOString() : "",
      probeInFlight: state.probeInFlight,
    };
  }

  #isAvailable(vendor: { name?: string; baseUrl?: string; priority?: number }, modelId: string, now: number): boolean {
    const state = this.#getState(vendor, modelId);
    return state.openUntil === 0 || (state.openUntil <= now && !state.probeInFlight);
  }

  #getState(vendor: { name?: string; baseUrl?: string; priority?: number }, modelId: string): CircuitState {
    const key = this.#key(vendor, modelId);
    let state = this.states.get(key);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        ejectionCount: 0,
        openUntil: 0,
        probeInFlight: false,
      };
      this.states.set(key, state);
    }
    return state;
  }

  #key(vendor: { name?: string; baseUrl?: string; priority?: number }, modelId: string): string {
    return JSON.stringify([
      Number.isInteger(vendor?.priority) ? vendor.priority : null,
      String(vendor?.name || ""),
      String(vendor?.baseUrl || ""),
      String(modelId || ""),
    ]);
  }
}
