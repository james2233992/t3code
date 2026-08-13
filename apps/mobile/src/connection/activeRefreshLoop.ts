export type MobileAppState = "active" | "background" | "extension" | "inactive" | "unknown";

export interface ActiveRefreshLoopOptions {
  readonly initialState: MobileAppState;
  readonly refresh: () => void;
  readonly subscribe: (listener: (state: MobileAppState) => void) => {
    readonly remove: () => void;
  };
  readonly intervalMs?: number;
  readonly setIntervalFn?: typeof setInterval;
  readonly clearIntervalFn?: typeof clearInterval;
}

export function startActiveRefreshLoop(options: ActiveRefreshLoopOptions): () => void {
  const intervalMs = options.intervalMs ?? 30_000;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let interval: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (interval !== undefined) {
      clearIntervalFn(interval);
      interval = undefined;
    }
  };
  const start = () => {
    if (interval !== undefined) return;
    options.refresh();
    interval = setIntervalFn(options.refresh, intervalMs);
  };
  const subscription = options.subscribe((state) => {
    if (state === "active") start();
    else stop();
  });

  if (options.initialState === "active") start();
  else if (options.initialState === "unknown") options.refresh();

  return () => {
    stop();
    subscription.remove();
  };
}
