import { Debouncer } from "@tanstack/react-pacer";

export interface StateStorage<R = unknown> {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => R;
  removeItem: (name: string) => R;
}

export interface SyncStateStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => unknown;
  removeItem: (name: string) => unknown;
}

export interface DebouncedStorage<R = unknown> extends StateStorage<R> {
  flush: () => void;
}

const browserMemoryStorage = createMemoryStorage();

export function createMemoryStorage(): SyncStateStorage {
  const store = new Map<string, string>();
  return {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    },
  };
}

export function isStateStorage(
  storage: Partial<StateStorage> | null | undefined,
): storage is StateStorage {
  return (
    storage !== null &&
    storage !== undefined &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  );
}

export function resolveStorage(storage: Partial<StateStorage> | null | undefined): StateStorage {
  return isStateStorage(storage) ? storage : createMemoryStorage();
}

/**
 * Sandboxed Fenix Code frames intentionally use an opaque origin. Merely
 * reading `window.localStorage` throws a SecurityError there, so callers must
 * resolve browser storage through this boundary instead of touching the
 * property while their module is loading.
 */
export function getBrowserStorage(
  browserWindow: Pick<Window, "localStorage"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
): SyncStateStorage {
  // Keep server/test module instances isolated. Only a real browser whose
  // storage getter is denied needs the shared in-memory substitute.
  if (browserWindow === undefined) return createMemoryStorage();
  try {
    return isStateStorage(browserWindow.localStorage)
      ? browserWindow.localStorage
      : browserMemoryStorage;
  } catch {
    return browserMemoryStorage;
  }
}

export function createDebouncedStorage(
  baseStorage: Partial<StateStorage> | null | undefined,
  debounceMs: number = 300,
): DebouncedStorage {
  const resolvedStorage = resolveStorage(baseStorage);
  const debouncedSetItem = new Debouncer(
    (name: string, value: string) => {
      resolvedStorage.setItem(name, value);
    },
    { wait: debounceMs },
  );

  return {
    getItem: (name) => resolvedStorage.getItem(name),
    setItem: (name, value) => {
      debouncedSetItem.maybeExecute(name, value);
    },
    removeItem: (name) => {
      debouncedSetItem.cancel();
      resolvedStorage.removeItem(name);
    },
    flush: () => {
      debouncedSetItem.flush();
    },
  };
}
