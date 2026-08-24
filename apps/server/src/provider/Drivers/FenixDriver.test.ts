import { describe, expect, it } from "@effect/vitest";
import { FenixSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { buildInitialFenixProviderSnapshot } from "../Layers/FenixProvider.ts";
import * as FenixPairingSessionBridge from "../Services/FenixPairingSessionBridge.ts";
import {
  applyFenixModelCatalogToSnapshot,
  FenixDriver,
  resolveFenixDriverEnabled,
} from "./FenixDriver.ts";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);
const decodeFenixSettingsEffect = Schema.decodeEffect(FenixSettings);

describe("FenixDriver", () => {
  it("is a dedicated provider driver with fail-closed defaults", () => {
    const defaults = FenixDriver.defaultConfig();
    const decoded = decodeFenixSettings(defaults);

    expect(FenixDriver.driverKind).toBe(ProviderDriverKind.make("fenix"));
    expect(FenixDriver.metadata).toEqual({
      displayName: "Fenix",
      supportsMultipleInstances: true,
    });
    expect(decoded.enabled).toBe(false);
  });

  it("enables only the portal-authenticated Companion runtime", () => {
    expect(resolveFenixDriverEnabled(false, undefined)).toBe(false);
    expect(resolveFenixDriverEnabled(false, "0")).toBe(false);
    expect(resolveFenixDriverEnabled(false, "true")).toBe(false);
    expect(resolveFenixDriverEnabled(false, "1")).toBe(true);
    expect(resolveFenixDriverEnabled(true, undefined)).toBe(true);
  });

  it("accepts pairing only before a finite, safe expiry boundary", () => {
    const session = { kind: "cookie" as const, authToken: "fenix-session-token" };
    const snapshot = FenixPairingSessionBridge.unsafePairingSessionSnapshotForTest(session, 20_001);

    expect(FenixPairingSessionBridge.activePairingSessionFromSnapshot(snapshot, 14_999)).toEqual(
      session,
    );
    expect(FenixPairingSessionBridge.activePairingSessionFromSnapshot(snapshot, 15_001)).toBeNull();
    expect(
      FenixPairingSessionBridge.activePairingSessionFromSnapshot(snapshot, Number.NaN),
    ).toBeNull();
    expect(
      FenixPairingSessionBridge.activePairingSessionFromSnapshot(
        FenixPairingSessionBridge.unsafePairingSessionSnapshotForTest(
          session,
          Number.POSITIVE_INFINITY,
        ),
        1,
      ),
    ).toBeNull();
  });

  it.effect("projects only the pairing catalog into the provider snapshot", () =>
    Effect.gen(function* () {
      const fenixSettings = yield* decodeFenixSettingsEffect({
        enabled: true,
        featuredModel: "xai/grok-4.5",
        customModels: ["anthropic/claude-sonnet-4-6"],
      });
      const base = yield* buildInitialFenixProviderSnapshot(fenixSettings);
      const snapshot = applyFenixModelCatalogToSnapshot(base, {
        canSelectModels: true,
        providers: [
          {
            providerSlug: "openai",
            displayName: "OpenAI",
            models: ["gpt-5.2-codex"],
            isDefault: true,
          },
        ],
      });

      expect(snapshot.models.map((model) => model.slug)).toEqual(["openai/gpt-5.2-codex"]);
      expect(snapshot.models.find((model) => model.isDefault)?.slug).toBe("openai/gpt-5.2-codex");
      expect("session" in snapshot).toBe(false);
      expect("token" in snapshot).toBe(false);
      expect(snapshot.models.some((model) => model.slug.includes("claude"))).toBe(false);
      expect(snapshot.models.some((model) => model.slug.includes("grok-4.5"))).toBe(false);
    }),
  );
});
