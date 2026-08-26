import { describe, expect, it } from "vite-plus/test";
import { getBrowserStorage } from "./storage";

describe("getBrowserStorage", () => {
  it("uses ephemeral storage when an opaque sandbox denies localStorage", () => {
    const deniedWindow = {} as Pick<Window, "localStorage">;
    Object.defineProperty(deniedWindow, "localStorage", {
      get() {
        throw new DOMException("Blocked by opaque origin", "SecurityError");
      },
    });

    const storage = getBrowserStorage(deniedWindow);
    storage.setItem("session", "isolated");

    expect(storage.getItem("session")).toBe("isolated");
  });

  it("uses the provided browser storage when it is available", () => {
    const values = new Map<string, string>();
    const storage = {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };

    expect(getBrowserStorage({ localStorage: storage })).toBe(storage);
  });
});
