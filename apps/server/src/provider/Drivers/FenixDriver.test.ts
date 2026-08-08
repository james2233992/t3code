import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  FenixSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
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
const DRIVER_KIND = ProviderDriverKind.make("fenix");
const INSTANCE_ID = ProviderInstanceId.make("fenix");
const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const makeFenixConfig = (overrides: Partial<FenixSettings> = {}) =>
  decodeFenixSettings({
    enabled: true,
    baseUrl: "https://iaonline.io",
    chatModelsPath: "/api/v1/ChatModels",
    sendMessagePath: "/api/v1/ChatModels/SendMessageWithOptions",
    featuredModel: "openai/gpt-oss-120b",
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
        FenixPairingSessionBridge.layerFromResolver(() =>
          FenixPairingSessionBridge.activePairingSessionFromSnapshot(
            {
              session: { kind: "cookie", authToken: "expired-fenix-session" },
              expiresAtEpochMs: 1,
            },
            2,
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

  it.effect("injects a paired Fenix session into a complete local driver turn", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
      const fetchMock = vi.fn(async (url: string | Request | URL, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return Response.json({ response: "Respuesta del agente Fenix" });
      });
      vi.stubGlobal("fetch", fetchMock);
      const instance = yield* createFenixInstance(
        FenixPairingSessionBridge.layerFromResolver(({ instanceId }) =>
          instanceId === INSTANCE_ID ? { kind: "cookie", authToken: "fenix-session-token" } : null,
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
        model: "openai/gpt-oss-120b",
        isGenericChatLane: true,
        source: "fenix-code",
        threadId,
      });
      expect(thread.turns).toHaveLength(1);
      expect(rolledBack.turns).toHaveLength(0);
    }),
  );
});
