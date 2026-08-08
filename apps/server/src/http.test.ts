import { assert, describe, it } from "@effect/vitest";

import { DESKTOP_RENDERER_ORIGINS } from "./http.ts";

describe("desktop renderer CORS origins", () => {
  it("allows Fenix desktop renderer origins and preserves legacy T3 compatibility", () => {
    assert.deepStrictEqual(DESKTOP_RENDERER_ORIGINS, [
      "fenixcode://app",
      "fenixcode-dev://app",
      "t3code://app",
      "t3code-dev://app",
    ]);
  });
});
