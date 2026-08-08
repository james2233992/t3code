import { ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import type { FenixPairingSession } from "../Layers/FenixAdapter.ts";

export interface FenixPairingSessionSnapshot {
  readonly session: FenixPairingSession;
  readonly expiresAtEpochMs?: number;
}

export interface FenixPairingSessionBridgeInput {
  readonly instanceId: ProviderInstanceId;
}

export class FenixPairingSessionBridge extends Context.Service<
  FenixPairingSessionBridge,
  {
    readonly resolvePairingSession: (
      input: FenixPairingSessionBridgeInput,
    ) => FenixPairingSession | null | undefined;
  }
>()("t3/provider/Services/FenixPairingSessionBridge") {}

export function activePairingSessionFromSnapshot(
  snapshot: FenixPairingSessionSnapshot | null | undefined,
  nowEpochMs: number,
): FenixPairingSession | null {
  if (!snapshot) return null;
  if (snapshot.expiresAtEpochMs !== undefined && snapshot.expiresAtEpochMs <= nowEpochMs) {
    return null;
  }
  return snapshot.session;
}

export const unpairedLayer = Layer.succeed(
  FenixPairingSessionBridge,
  FenixPairingSessionBridge.of({
    resolvePairingSession: () => null,
  }),
);

export const layerFromResolver = (
  resolvePairingSession: FenixPairingSessionBridge["Service"]["resolvePairingSession"],
) =>
  Layer.succeed(FenixPairingSessionBridge, FenixPairingSessionBridge.of({ resolvePairingSession }));
