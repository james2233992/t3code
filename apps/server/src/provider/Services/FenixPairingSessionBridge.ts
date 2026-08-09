import { ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import {
  isValidFenixCodeTenantScope,
  type FenixCodeTenantScope,
} from "../../fenix/FenixCodeTenantScope.ts";
import type { FenixPairingSession } from "../Layers/FenixAdapter.ts";

export interface FenixPairingSessionSnapshot {
  readonly session: FenixPairingSession;
  readonly expiresAtEpochMs: number;
  readonly tenantScope: FenixCodeTenantScope;
}

export interface FenixPairingSessionBridgeInput {
  readonly instanceId: ProviderInstanceId;
}

export class FenixPairingSessionBridge extends Context.Service<
  FenixPairingSessionBridge,
  {
    readonly resolvePairingSessionSnapshot: (
      input: FenixPairingSessionBridgeInput,
    ) => FenixPairingSessionSnapshot | null | undefined;
  }
>()("t3/provider/Services/FenixPairingSessionBridge") {}

const MINIMUM_PAIRING_TTL_MS = 5_000;

export function activePairingSessionFromSnapshot(
  snapshot: FenixPairingSessionSnapshot | null | undefined,
  nowEpochMs: number,
): FenixPairingSession | null {
  return activePairingEnvelopeFromSnapshot(snapshot, nowEpochMs)?.session ?? null;
}

export function activePairingEnvelopeFromSnapshot(
  snapshot: FenixPairingSessionSnapshot | null | undefined,
  nowEpochMs: number,
): FenixPairingSessionSnapshot | null {
  if (!snapshot) return null;
  if (!Number.isSafeInteger(nowEpochMs)) return null;
  if (!Number.isSafeInteger(snapshot.expiresAtEpochMs)) return null;
  if (!isValidFenixCodeTenantScope(snapshot.tenantScope)) return null;
  if (snapshot.expiresAtEpochMs <= nowEpochMs + MINIMUM_PAIRING_TTL_MS) {
    return null;
  }
  return snapshot;
}

export function unsafePairingSessionSnapshotForTest(
  session: FenixPairingSession,
  expiresAtEpochMs = Number.MAX_SAFE_INTEGER,
  tenantScope: FenixCodeTenantScope = { companyId: 1, userId: 1 },
): FenixPairingSessionSnapshot {
  return { session, expiresAtEpochMs, tenantScope };
}

export const unpairedLayer = Layer.succeed(
  FenixPairingSessionBridge,
  FenixPairingSessionBridge.of({
    resolvePairingSessionSnapshot: () => null,
  }),
);

export const layerFromSnapshotResolver = (
  resolvePairingSessionSnapshot: FenixPairingSessionBridge["Service"]["resolvePairingSessionSnapshot"],
) =>
  Layer.succeed(
    FenixPairingSessionBridge,
    FenixPairingSessionBridge.of({ resolvePairingSessionSnapshot }),
  );
