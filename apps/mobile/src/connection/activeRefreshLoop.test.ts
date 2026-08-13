import { afterEach, describe, expect, it, vi } from "@effect/vitest";

import { startActiveRefreshLoop, type MobileAppState } from "./activeRefreshLoop";

afterEach(() => {
  vi.useRealTimers();
});

describe("startActiveRefreshLoop", () => {
  it("refreshes on a bounded interval only while the app is active", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    let listener: ((state: MobileAppState) => void) | undefined;
    const remove = vi.fn();
    const close = startActiveRefreshLoop({
      initialState: "active",
      refresh,
      subscribe: (next) => {
        listener = next;
        return { remove };
      },
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    listener?.("background");
    vi.advanceTimersByTime(90_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    listener?.("active");
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(4);

    close();
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("performs one startup refresh when React Native has not resolved app state", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const close = startActiveRefreshLoop({
      initialState: "unknown",
      refresh,
      subscribe: () => ({ remove: vi.fn() }),
    });

    expect(refresh).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(90_000);
    expect(refresh).toHaveBeenCalledOnce();
    close();
  });
});
