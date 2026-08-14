import { describe, expect, it } from "@effect/vitest";

import { normalizeWebBasePath, routerBasePath } from "./buildBasePath.ts";

describe("Fenix Code web base path", () => {
  it("keeps the upstream root default and supports the reviewed Code Lab prefix", () => {
    expect(normalizeWebBasePath(undefined)).toBe("/");
    expect(normalizeWebBasePath(" /code-lab/ ")).toBe("/code-lab/");
    expect(routerBasePath("/code-lab/")).toBe("/code-lab");
  });

  it.each(["code-lab/", "/code-lab", "//code-lab/", "/../code-lab/", "/code-lab/?x=1"])(
    "rejects a non-normalized or ambiguous base path: %s",
    (value) => {
      expect(() => normalizeWebBasePath(value)).toThrow("ruta absoluta normalizada");
    },
  );
});
