import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

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

export interface FenixCompanionBridgeHttpConfig {
  readonly baseUrl: string;
  readonly deviceId: string;
  readonly deviceCredential?: string | undefined;
  readonly deviceCredentialFile?: string | undefined;
  readonly audience?: string | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly nowEpochMs?: (() => number) | undefined;
}

export class FenixPairingSessionBridge extends Context.Service<
  FenixPairingSessionBridge,
  {
    readonly resolvePairingSessionSnapshot: (
      input: FenixPairingSessionBridgeInput,
    ) => Effect.Effect<FenixPairingSessionSnapshot | null | undefined>;
  }
>()("t3/provider/Services/FenixPairingSessionBridge") {}

const MINIMUM_PAIRING_TTL_MS = 5_000;
const FENIX_AUDIENCE = "https://iaonline.io";
const FENIX_CHAT_MODELS_SCOPE = "fenix.chatmodels.generic";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{16,64}$/;
const encodeCredentialRequestJson = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      deviceCredential: Schema.String,
      audience: Schema.String,
    }),
  ),
);

class FenixCompanionBridgeRequestError extends Data.TaggedError(
  "FenixCompanionBridgeRequestError",
)<{}> {}

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
    resolvePairingSessionSnapshot: () => Effect.succeed(null),
  }),
);

export const layerFromSnapshotResolver = (
  resolvePairingSessionSnapshot: (
    input: FenixPairingSessionBridgeInput,
  ) => FenixPairingSessionSnapshot | null | undefined,
) =>
  Layer.succeed(
    FenixPairingSessionBridge,
    FenixPairingSessionBridge.of({
      resolvePairingSessionSnapshot: (input) =>
        Effect.sync(() => resolvePairingSessionSnapshot(input)),
    }),
  );

export const layerFromEffectResolver = (
  resolvePairingSessionSnapshot: FenixPairingSessionBridge["Service"]["resolvePairingSessionSnapshot"],
) =>
  Layer.succeed(
    FenixPairingSessionBridge,
    FenixPairingSessionBridge.of({ resolvePairingSessionSnapshot }),
  );

function isCleanSingleLineSecret(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x20 || codePoint === 0x7f) return false;
  }
  return true;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readRecordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseExpiresAtEpochMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return null;
  }
  const epochMs = Date.parse(value);
  return Number.isSafeInteger(epochMs) ? epochMs : null;
}

function readDeviceCredential(
  config: FenixCompanionBridgeHttpConfig,
): Effect.Effect<string | null, never, FileSystem.FileSystem | Path.Path> {
  if (config.deviceCredential !== undefined) {
    return Effect.succeed(
      isCleanSingleLineSecret(config.deviceCredential) ? config.deviceCredential : null,
    );
  }
  if (!config.deviceCredentialFile) return Effect.succeed(null);

  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const credentialPath = path.resolve(config.deviceCredentialFile!);
    const [stat, canonicalPath] = yield* Effect.all([
      fileSystem.stat(credentialPath),
      fileSystem.realPath(credentialPath),
    ]);
    if (stat.type !== "File" || canonicalPath !== credentialPath || (stat.mode & 0o077) !== 0) {
      return null;
    }
    const value = (yield* fileSystem.readFileString(credentialPath)).replace(/\r?\n$/, "");
    return isCleanSingleLineSecret(value) ? value : null;
  }).pipe(Effect.orElseSucceed(() => null));
}

function resolveCompanionEndpoint(config: FenixCompanionBridgeHttpConfig): string | null {
  const deviceId = config.deviceId.trim();
  if (!DEVICE_ID_PATTERN.test(deviceId)) return null;

  try {
    const base = new URL(config.baseUrl.trim());
    if (!["http:", "https:"].includes(base.protocol)) return null;
    if (!LOOPBACK_HOSTS.has(base.hostname)) return null;
    return new URL(
      `/api/v1/code-lab/companion/devices/${encodeURIComponent(deviceId)}/fenix-credential`,
      base.origin,
    ).toString();
  } catch {
    return null;
  }
}

function snapshotFromCompanionEnvelope(
  payload: unknown,
  config: FenixCompanionBridgeHttpConfig,
  nowEpochMs: number,
): FenixPairingSessionSnapshot | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const kind = readRecordString(record, "kind");
  const accessToken = readRecordString(record, "accessToken");
  const audience = readRecordString(record, "audience");
  const expiresAtEpochMs = parseExpiresAtEpochMs(record.expiresAt);
  const scopes = record.scopes;
  const owner = record.owner;
  const device = record.device;

  if (
    kind !== "bearer" ||
    accessToken === null ||
    !isCleanSingleLineSecret(accessToken) ||
    audience !== (config.audience ?? FENIX_AUDIENCE) ||
    expiresAtEpochMs === null ||
    !Array.isArray(scopes) ||
    !scopes.includes(FENIX_CHAT_MODELS_SCOPE) ||
    !owner ||
    typeof owner !== "object" ||
    Array.isArray(owner)
  ) {
    return null;
  }

  const ownerRecord = owner as Record<string, unknown>;
  if (
    !isPositiveSafeInteger(ownerRecord.companyId) ||
    !isPositiveSafeInteger(ownerRecord.userId) ||
    !isPositiveSafeInteger(ownerRecord.agentId)
  ) {
    return null;
  }

  if (device && typeof device === "object" && !Array.isArray(device)) {
    const deviceId = (device as Record<string, unknown>).deviceId;
    if (typeof deviceId === "string" && deviceId !== config.deviceId.trim()) {
      return null;
    }
  }

  const snapshot: FenixPairingSessionSnapshot = {
    session: { kind: "bearer", token: accessToken },
    expiresAtEpochMs,
    tenantScope: {
      companyId: ownerRecord.companyId,
      userId: ownerRecord.userId,
    },
  };
  return activePairingEnvelopeFromSnapshot(snapshot, nowEpochMs);
}

export function resolvePairingSessionSnapshotFromHttp(
  config: FenixCompanionBridgeHttpConfig,
): Effect.Effect<FenixPairingSessionSnapshot | null> {
  return Effect.gen(function* () {
    const requestUrl = resolveCompanionEndpoint(config);
    const deviceCredential = yield* readDeviceCredential(config);
    if (!requestUrl || !deviceCredential) return null;
    const audience = config.audience ?? FENIX_AUDIENCE;
    const body = yield* encodeCredentialRequestJson({ deviceCredential, audience }).pipe(
      Effect.orElseSucceed(() => null),
    );
    if (!body) return null;
    const nowEpochMs = config.nowEpochMs?.() ?? (yield* Clock.currentTimeMillis);

    const response = yield* Effect.tryPromise({
      try: () =>
        (config.fetch ?? fetch)(requestUrl, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body,
        }),
      catch: () => new FenixCompanionBridgeRequestError(),
    }).pipe(Effect.orElseSucceed(() => null));
    if (!response?.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;

    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: () => new FenixCompanionBridgeRequestError(),
    }).pipe(Effect.orElseSucceed(() => null));
    return snapshotFromCompanionEnvelope(payload, config, nowEpochMs);
  }).pipe(Effect.provide(NodeServices.layer));
}

export const layerFromHttpConfig = (config: FenixCompanionBridgeHttpConfig) =>
  layerFromEffectResolver(() => resolvePairingSessionSnapshotFromHttp(config));

function configFromEnvironment(): FenixCompanionBridgeHttpConfig | null {
  const baseUrl = process.env.FENIX_CODE_COMPANION_BASE_URL?.trim();
  const deviceId = process.env.FENIX_CODE_COMPANION_DEVICE_ID?.trim();
  const deviceCredentialFile = process.env.FENIX_CODE_COMPANION_DEVICE_CREDENTIAL_FILE?.trim();
  if (!baseUrl || !deviceId || !deviceCredentialFile) return null;
  return { baseUrl, deviceId, deviceCredentialFile };
}

export const liveLayer = Layer.succeed(
  FenixPairingSessionBridge,
  FenixPairingSessionBridge.of({
    resolvePairingSessionSnapshot: () => {
      const config = configFromEnvironment();
      return config ? resolvePairingSessionSnapshotFromHttp(config) : Effect.succeed(null);
    },
  }),
);
