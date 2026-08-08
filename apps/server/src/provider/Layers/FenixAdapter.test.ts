import { describe, expect, it } from "@effect/vitest";
import { FenixSettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeFenixAdapter } from "./FenixAdapter.ts";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

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
      const adapter = yield* makeFenixAdapter(
        decodeFenixSettings({
          enabled: true,
          baseUrl: "https://iaonline.io",
          sendMessagePath: "/api/v1/ChatModels/SendMessageWithOptions",
          featuredModel: "openai/gpt-oss-120b",
        }),
        {
          fetch: fetchImpl,
          instanceId: ProviderInstanceId.make("fenix"),
          pairingSession: { kind: "cookie", cookieHeader: "AuthToken=fenix-session" },
        },
      );
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

  it.effect("fails closed before reaching the Fenix backend without a pairing session", () =>
    Effect.gen(function* () {
      const fetchImpl = (() => {
        throw new Error("fetch must not be called without pairing");
      }) as unknown as typeof fetch;
      const adapter = yield* makeFenixAdapter(
        decodeFenixSettings({
          enabled: true,
          baseUrl: "https://iaonline.io",
          sendMessagePath: "/api/v1/ChatModels/SendMessageWithOptions",
          featuredModel: "openai/gpt-oss-120b",
        }),
        { fetch: fetchImpl, instanceId: ProviderInstanceId.make("fenix") },
      );
      const threadId = ThreadId.make("thread-fenix-unpaired");

      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
      });
      const error = yield* adapter
        .sendTurn({ threadId, input: "crea una funcion" })
        .pipe(Effect.flip);
      const sessions = yield* adapter.listSessions();

      expect(error._tag).toBe("ProviderAdapterValidationError");
      expect(error.message).toContain("active Code Lab pairing session");
      expect(sessions[0]?.status).toBe("ready");
      expect(sessions[0]?.activeTurnId).toBeUndefined();
    }),
  );
});
