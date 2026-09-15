/** Injectable wall-clock seam for deterministic application tests. */
export interface Clock {
  nowMs(): number;
}

// Re-export shared runtime seams from this frequently imported module; this
// keeps legacy `platform/runtime/clock` imports source-compatible.
export type { IdGenerator, RandomSource } from "./ids";

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }

  nowSeconds(): number {
    return Math.floor(this.nowMs() / 1000);
  }
}

export class FixedClock implements Clock {
  constructor(private readonly valueMs: number) {}

  nowMs(): number {
    return this.valueMs;
  }

  nowSeconds(): number {
    return Math.floor(this.valueMs / 1000);
  }
}

export const systemClock: SystemClock = new SystemClock();

export function nowMs(clock: Clock = systemClock): number {
  return clock.nowMs();
}

export function nowSeconds(clock: Clock = systemClock): number {
  return Math.floor(clock.nowMs() / 1000);
}
