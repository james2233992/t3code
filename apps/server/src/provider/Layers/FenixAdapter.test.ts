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
  it.effect("posts turns through the Fenix generic chat lane and emits canonical events", () =>
    Effect.gen(function* () {
      const requests: Array<{ url: string; body: string }> = [];
      const fetchImpl = (async (url, init) => {
        requests.push({
          url: String(url),
          body: String(init?.body ?? "{}"),
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
        { fetch: fetchImpl, instanceId: ProviderInstanceId.make("fenix") },
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
});
