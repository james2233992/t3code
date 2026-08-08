import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { FenixSettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as FenixPairingSessionBridge from "../Services/FenixPairingSessionBridge.ts";
import { FenixDriver } from "./FenixDriver.ts";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);
const decodeUnknownJsonString = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const INSTANCE_ID = ProviderInstanceId.make("fenix");
const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");
const ACTIVE_EXPIRES_AT_EPOCH_MS = 4_102_444_800_000;

const makeFenixConfig = (overrides: Partial<FenixSettings> = {}) =>
  decodeFenixSettings({
    enabled: true,
    baseUrl: "https://iaonline.io",
    chatModelsPath: "/api/v1/ChatModels",
    sendMessagePath: "/api/v1/ChatModels/SendMessageWithOptions",
    featuredModel: "groq/openai/gpt-oss-120b",
    customModels: [],
    ...overrides,
  });

const BackgroundPolicyAlwaysRunLayer = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  reportHostPowerState: () => Effect.void,
  snapshot: Effect.succeed({
    hostPower: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: true,
      updatedAt: TEST_EPOCH,
    },
    leases: [],
    activeForegroundLeaseCount: 0,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: TEST_EPOCH,
  }),
  streamChanges: Stream.empty,
  hasDemand: () => Effect.succeed(true),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

const driverLayer = (
  bridgeLayer: Layer.Layer<FenixPairingSessionBridge.FenixPairingSessionBridge>,
) =>
  Layer.mergeAll(
    NodeServices.layer,
    BackgroundPolicyAlwaysRunLayer,
    ServerSettingsService.layerTest(),
    bridgeLayer,
  );

const createFenixInstance = (
  bridgeLayer: Layer.Layer<FenixPairingSessionBridge.FenixPairingSessionBridge>,
) =>
  Effect.scoped(
    FenixDriver.create({
      instanceId: INSTANCE_ID,
      displayName: "Fenix",
      enabled: true,
      config: makeFenixConfig(),
      environment: [],
    }),
  ).pipe(Effect.provide(driverLayer(bridgeLayer)));

describe("FenixDriver", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps pairing snapshots inactive for invalid metadata and expiry boundaries", () => {
    const session = { kind: "cookie" as const, authToken: "fenix-session-token" };
    const active = FenixPairingSessionBridge.unsafePairingSessionSnapshotForTest(session, 20_001);

    expect(
      FenixPairingSessionBridge.activePairingSessionFromSnapshot(active, Number.NaN),
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
    expect(FenixPairingSessionBridge.activePairingSessionFromSnapshot(active, 15_001)).toBeNull();
    expect(FenixPairingSessionBridge.activePairingSessionFromSnapshot(active, 14_999)).toEqual(
      session,
    );
  });

  it.effect("keeps the provider fail-closed when no Code Lab pairing is available", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => Response.json({ response: "unexpected" }));
      vi.stubGlobal("fetch", fetchMock);
      const instance = yield* createFenixInstance(FenixPairingSessionBridge.unpairedLayer);
      const threadId = ThreadId.make("thread-fenix-driver-unpaired");

      yield* instance.adapter.startSession({ threadId, runtimeMode: "full-access" });
      const error = yield* instance.adapter.sendTurn({ threadId, input: "hola" }).pipe(Effect.flip);

      expect(error._tag).toBe("ProviderAdapterValidationError");
      expect(error.message).toContain("active Code Lab pairing session");
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

  it.effect("treats expired pairing snapshots as unpaired before fetch", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => Response.json({ response: "unexpected" }));
      vi.stubGlobal("fetch", fetchMock);
      const instance = yield* createFenixInstance(
        FenixPairingSessionBridge.layerFromSnapshotResolver(() =>
          FenixPairingSessionBridge.unsafePairingSessionSnapshotForTest(
            { kind: "cookie", authToken: "expired-fenix-session" },
            1,
          ),
        ),
      );
      const threadId = ThreadId.make("thread-fenix-driver-expired");

      yield* instance.adapter.startSession({ threadId, runtimeMode: "full-access" });
      const error = yield* instance.adapter.sendTurn({ threadId, input: "hola" }).pipe(Effect.flip);

      expect(error._tag).toBe("ProviderAdapterValidationError");
      expect(error.message).toContain("active Code Lab pairing session");
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

  it.effect("rejects malformed pairing snapshot metadata before fetch", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => Response.json({ response: "unexpected" }));
      vi.stubGlobal("fetch", fetchMock);

      for (const [index, expiresAtEpochMs] of [
        undefined,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ].entries()) {
        const instance = yield* createFenixInstance(
          FenixPairingSessionBridge.layerFromSnapshotResolver(() => ({
            session: { kind: "cookie", authToken: `bad-expiry-${index}` },
            expiresAtEpochMs: expiresAtEpochMs as number,
          })),
        );
        const threadId = ThreadId.make(`thread-fenix-driver-bad-expiry-${index}`);

        yield* instance.adapter.startSession({ threadId, runtimeMode: "full-access" });
        const error = yield* instance.adapter
          .sendTurn({ threadId, input: "hola" })
          .pipe(Effect.flip);

        expect(error._tag).toBe("ProviderAdapterValidationError");
        expect(error.message).toContain("active Code Lab pairing session");
      }

      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

  it.effect("injects a paired Fenix session into a complete local driver turn", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
      const fetchMock = vi.fn(async (url: string | Request | URL, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return Response.json({ response: "Respuesta del agente Fenix" });
      });
      vi.stubGlobal("fetch", fetchMock);
      const instance = yield* createFenixInstance(
        FenixPairingSessionBridge.layerFromSnapshotResolver(({ instanceId }) =>
          instanceId === INSTANCE_ID
            ? FenixPairingSessionBridge.unsafePairingSessionSnapshotForTest(
                { kind: "cookie", authToken: "fenix-session-token" },
                ACTIVE_EXPIRES_AT_EPOCH_MS,
              )
            : null,
        ),
      );
      const threadId = ThreadId.make("thread-fenix-driver-paired");

      yield* instance.adapter.startSession({ threadId, runtimeMode: "full-access" });
      const result = yield* instance.adapter.sendTurn({
        threadId,
        input: "construye una oferta",
      });
      const thread = yield* instance.adapter.readThread(threadId);
      const rolledBack = yield* instance.adapter.rollbackThread(threadId, 1);

      expect(result.threadId).toBe(threadId);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://iaonline.io/api/v1/ChatModels/SendMessageWithOptions");
      expect(requests[0]?.init?.method).toBe("POST");
      expect(requests[0]?.init?.credentials).toBe("include");
      expect(requests[0]?.init?.headers).toMatchObject({
        cookie: "AuthToken=fenix-session-token",
      });
      expect(decodeUnknownJsonString(String(requests[0]?.init?.body))).toMatchObject({
        message: "construye una oferta",
        model: "groq/openai/gpt-oss-120b",
        isGenericChatLane: true,
        source: "fenix-code",
        threadId,
        turnId: result.turnId,
        requestId: result.turnId,
      });
      expect(thread.turns).toHaveLength(1);
      expect(rolledBack.turns).toHaveLength(0);
    }),
  );

  it.effect("resolves the pairing bridge once per accepted turn and never on start", () =>
    Effect.gen(function* () {
      const requests: Array<string> = [];
      const fetchMock = vi.fn(async () => {
        requests.push("fetch");
        return Response.json({ response: "ok" });
      });
      vi.stubGlobal("fetch", fetchMock);
      let resolveCount = 0;
      const instance = yield* createFenixInstance(
        FenixPairingSessionBridge.layerFromSnapshotResolver(() => {
          resolveCount += 1;
          return FenixPairingSessionBridge.unsafePairingSessionSnapshotForTest(
            { kind: "cookie", authToken: "fenix-session-token" },
            ACTIVE_EXPIRES_AT_EPOCH_MS,
          );
        }),
      );
      const threadId = ThreadId.make("thread-fenix-driver-resolver-count");

      yield* instance.adapter.startSession({ threadId, runtimeMode: "full-access" });
      expect(resolveCount).toBe(0);

      yield* instance.adapter.sendTurn({ threadId, input: "primer turno" });
      expect(resolveCount).toBe(1);

      yield* instance.adapter.sendTurn({ threadId, input: "segundo turno" });
      expect(resolveCount).toBe(2);
      expect(requests).toHaveLength(2);
    }),
  );
});
