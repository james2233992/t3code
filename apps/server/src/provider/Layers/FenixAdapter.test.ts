import { describe, expect, it } from "@effect/vitest";
import { FenixSettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeFenixAdapter } from "./FenixAdapter.ts";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const fenixSettings = (overrides: Partial<FenixSettings> = {}) =>
  decodeFenixSettings({
    enabled: true,
    baseUrl: "https://iaonline.io",
    sendMessagePath: "/api/v1/ChatModels/SendMessageWithOptions",
    featuredModel: "openai/gpt-oss-120b",
    ...overrides,
  });

const throwingFetch = (() => {
  throw new Error("fetch must not be called");
}) as unknown as typeof fetch;

describe("FenixAdapter", () => {
  it.effect("posts turns through the Fenix generic chat lane with the paired Fenix cookie", () =>
    Effect.gen(function* () {
      const requests: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
      const fetchImpl = (async (url, init) => {
        requests.push({
          url: String(url),
          body: String(init?.body ?? "{}"),
          headers: init?.headers as Record<string, string>,
        });
        return Response.json({ response: "respuesta fenix" });
      }) as typeof fetch;
      const adapter = yield* makeFenixAdapter(fenixSettings(), {
        fetch: fetchImpl,
        instanceId: ProviderInstanceId.make("fenix"),
        pairingSession: { kind: "cookie", authToken: "fenix-session" },
      });
      const threadId = ThreadId.make("thread-fenix");
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.take(6),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
      });
      const result = yield* adapter.sendTurn({ threadId, input: "crea una funcion" });
      const events = Array.from(yield* Fiber.join(eventsFiber));
      const requestBody = decodeUnknownJson(requests[0]?.body ?? "{}");

      expect(result.threadId).toBe(threadId);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://iaonline.io/api/v1/ChatModels/SendMessageWithOptions");
      expect(requests[0]?.headers).toMatchObject({
        accept: "application/json",
        "content-type": "application/json",
        cookie: "AuthToken=fenix-session",
      });
      expect(requestBody).toMatchObject({
        message: "crea una funcion",
        model: "openai/gpt-oss-120b",
        isGenericChatLane: true,
        source: "fenix-code",
        threadId,
      });
      expect(events.map((event) => event.type)).toEqual([
        "session.started",
        "session.state.changed",
        "thread.started",
        "turn.started",
        "content.delta",
        "turn.completed",
      ]);
      const contentDelta = events.find((event) => event.type === "content.delta");
      expect(contentDelta?.payload).toMatchObject({
        streamKind: "assistant_text",
        delta: "respuesta fenix",
      });
    }),
  );

  it.effect("posts turns with a paired bearer token", () =>
    Effect.gen(function* () {
      const requests: Array<{ headers: Record<string, string> }> = [];
      const fetchImpl = (async (_url, init) => {
        requests.push({ headers: init?.headers as Record<string, string> });
        return Response.json({ response: "respuesta bearer" });
      }) as typeof fetch;
      const adapter = yield* makeFenixAdapter(fenixSettings(), {
        fetch: fetchImpl,
        instanceId: ProviderInstanceId.make("fenix"),
        pairingSession: { kind: "bearer", token: "fenix.bearer-token_1" },
      });
      const threadId = ThreadId.make("thread-fenix-bearer");

      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "crea una funcion" });

      expect(requests[0]?.headers).toMatchObject({
        authorization: "Bearer fenix.bearer-token_1",
      });
    }),
  );

  it.effect("fails closed before reaching the Fenix backend without a pairing session", () =>
    Effect.gen(function* () {
      const adapter = yield* makeFenixAdapter(fenixSettings(), {
        fetch: throwingFetch,
        instanceId: ProviderInstanceId.make("fenix"),
      });
      const threadId = ThreadId.make("thread-fenix-unpaired");
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
      });
      const events = Array.from(yield* Fiber.join(eventsFiber));
      const error = yield* adapter
        .sendTurn({ threadId, input: "crea una funcion" })
        .pipe(Effect.flip);
      const sessions = yield* adapter.listSessions();

      expect(error._tag).toBe("ProviderAdapterValidationError");
      expect(error.message).toContain("active Code Lab pairing session");
      expect(sessions[0]?.status).toBe("ready");
      expect(sessions[0]?.activeTurnId).toBeUndefined();
      const stateChanged = events.find((event) => event.type === "session.state.changed");
      expect(stateChanged?.payload).toMatchObject({
        state: "ready",
        reason: "Fenix pairing required",
      });
    }),
  );

  it.effect("refuses to attach pairing credentials to non-Fenix origins", () =>
    Effect.gen(function* () {
      const adapter = yield* makeFenixAdapter(
        fenixSettings({ baseUrl: "https://not-fenix.example" }),
        {
          fetch: throwingFetch,
          instanceId: ProviderInstanceId.make("fenix"),
          pairingSession: { kind: "cookie", authToken: "fenix-session" },
        },
      );
      const threadId = ThreadId.make("thread-fenix-wrong-origin");

      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
      });
      const error = yield* adapter
        .sendTurn({ threadId, input: "crea una funcion" })
        .pipe(Effect.flip);
      const sessions = yield* adapter.listSessions();

      expect(error._tag).toBe("ProviderAdapterValidationError");
      expect(error.message).toContain("https://iaonline.io");
      expect(sessions[0]?.status).toBe("ready");
      expect(sessions[0]?.activeTurnId).toBeUndefined();
    }),
  );

  it.effect("rejects malformed cookie and bearer pairing values before fetch", () =>
    Effect.gen(function* () {
      for (const [index, pairingSession] of [
        { kind: "cookie" as const, authToken: "fenix-session; Other=evil" },
        { kind: "bearer" as const, token: "fenix-token\r\nx-leak: true" },
      ].entries()) {
        const adapter = yield* makeFenixAdapter(fenixSettings(), {
          fetch: throwingFetch,
          instanceId: ProviderInstanceId.make("fenix"),
          pairingSession,
        });
        const threadId = ThreadId.make(`thread-fenix-malformed-${index}`);

        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
        });
        const error = yield* adapter
          .sendTurn({ threadId, input: "crea una funcion" })
          .pipe(Effect.flip);

        expect(error._tag).toBe("ProviderAdapterValidationError");
        expect(error.message).toContain("active Code Lab pairing session");
      }
    }),
  );

  it.effect(
    "restores ready state and emits a failed turn when Fenix rejects the paired session",
    () =>
      Effect.gen(function* () {
        const fetchImpl = (async () =>
          Response.json({ error: "unauthorized" }, { status: 401 })) as unknown as typeof fetch;
        const adapter = yield* makeFenixAdapter(fenixSettings(), {
          fetch: fetchImpl,
          instanceId: ProviderInstanceId.make("fenix"),
          pairingSession: { kind: "cookie", authToken: "expired-token" },
        });
        const threadId = ThreadId.make("thread-fenix-401");
        const eventsFiber = yield* adapter.streamEvents.pipe(
          Stream.take(6),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;

        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
        });
        const error = yield* adapter
          .sendTurn({ threadId, input: "crea una funcion" })
          .pipe(Effect.flip);
        const sessions = yield* adapter.listSessions();
        const events = Array.from(yield* Fiber.join(eventsFiber));

        expect(error._tag).toBe("ProviderAdapterRequestError");
        expect(sessions[0]?.status).toBe("ready");
        expect(sessions[0]?.activeTurnId).toBeUndefined();
        expect(sessions[0]?.lastError).toContain("HTTP 401");
        expect(events.map((event) => event.type)).toEqual([
          "session.started",
          "session.state.changed",
          "thread.started",
          "turn.started",
          "runtime.error",
          "turn.completed",
        ]);
        const failedTurn = events.find((event) => event.type === "turn.completed");
        expect(failedTurn?.payload).toMatchObject({
          state: "failed",
        });
        expect(
          failedTurn?.type === "turn.completed" ? failedTurn.payload.errorMessage : undefined,
        ).toContain("HTTP 401");
      }),
  );
});
