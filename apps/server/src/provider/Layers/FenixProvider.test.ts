import { describe, expect, it } from "@effect/vitest";
import { FenixSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  buildInitialFenixProviderSnapshot,
  FENIX_FEATURED_CODING_MODEL,
  fenixModelsFromSettings,
} from "./FenixProvider.ts";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);

describe("FenixProvider", () => {
  it.effect("starts disabled and advertises the approved coding model", () =>
    Effect.gen(function* () {
      const settings = decodeFenixSettings({});
      const snapshot = yield* buildInitialFenixProviderSnapshot(settings);

      expect(snapshot.displayName).toBe("Fenix");
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.models.map((model) => model.slug)).toContain(FENIX_FEATURED_CODING_MODEL);
      expect(snapshot.message).toMatch(/disabled until Code Lab pairing QA/i);
    }),
  );

  it("keeps the featured model ahead of custom model additions", () => {
    const models = fenixModelsFromSettings({
      featuredModel: FENIX_FEATURED_CODING_MODEL,
      customModels: ["local-experiment"],
    });

    expect(models[0]?.slug).toBe(FENIX_FEATURED_CODING_MODEL);
    expect(models.map((model) => model.slug)).toContain("local-experiment");
  });
});
