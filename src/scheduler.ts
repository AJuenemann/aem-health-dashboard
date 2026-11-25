/**
 * Wiederholte Läufe ohne Überlappung: der nächste Lauf wird erst nach Ende des vorigen
 * eingeplant (Intervall ± Versatz). Ein hängender Lauf staut sich also nie auf.
 */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LoopOptions {
  run: () => Promise<void>;
  intervalMs: number;
  /** Erster Lauf nach so vielen ms (Versatz zwischen Umgebungen). */
  initialDelayMs?: number;
  /** Zufallsanteil 0..1 des Intervalls, ± halb nach jeder Seite. Default 0,2. */
  jitter?: number;
  random?: () => number;
  timers?: Timers;
  onError?: (e: unknown) => void;
}

export interface Loop {
  start(): void;
  stop(): void;
}

export function createLoop(o: LoopOptions): Loop {
  const timers: Timers = o.timers ?? { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };
  const random = o.random ?? Math.random;
  const jitter = o.jitter ?? 0.2;
  let handle: unknown;
  let running = false;
  let stopped = true;

  const next = (ms: number): void => {
    if (stopped) return;
    handle = timers.setTimeout(async () => {
      if (stopped || running) return;
      running = true;
      try {
        await o.run();
      } catch (e) {
        o.onError?.(e);
      } finally {
        running = false;
      }
      next(Math.max(0, Math.round(o.intervalMs * (1 + (random() - 0.5) * jitter))));
    }, ms);
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      next(o.initialDelayMs ?? 0);
    },
    stop() {
      stopped = true;
      timers.clearTimeout(handle);
    },
  };
}
