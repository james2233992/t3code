import { describe, expect, it } from "@effect/vitest";
import { FenixSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import * as FenixPairingSessionBridge from "../Services/FenixPairingSessionBridge.ts";
import { FenixDriver, resolveFenixDriverEnabled } from "./FenixDriver.ts";

describe("FenixDriver", () => {
  it("is a dedicated provider driver with fail-closed defaults", () => {
    const defaults = FenixDriver.defaultConfig();
    const decoded = Schema.decodeSync(FenixSettings)(defaults);

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
});
