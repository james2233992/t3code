import { randomUUID } from "node:crypto";

import {
  EventId,
  type FenixSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { FenixAdapterShape } from "../Services/FenixAdapter.ts";

const PROVIDER = ProviderDriverKind.make("fenix");
const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

interface FenixSessionContext {
  session: ProviderSession;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  stopped: boolean;
}

export interface FenixAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly fetch?: typeof fetch;
}

function resolveUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim() || "https://iaonline.io";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = path.trim().replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBase).toString();
}

function firstString(...values: ReadonlyArray<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function extractAssistantText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const direct = firstString(
    record.response,
    record.content,
    record.message,
    record.text,
    record.answer,
    record.result,
  );
  if (direct) return direct;

  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nested = data as Record<string, unknown>;
    return (
      firstString(
        nested.response,
        nested.content,
        nested.message,
        nested.text,
        nested.answer,
        nested.result,
      ) ?? ""
    );
  }

  return "";
}

export function makeFenixAdapter(settings: FenixSettings, options?: FenixAdapterLiveOptions) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("fenix");
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, FenixSessionContext>();
    const fetchImpl = options?.fetch ?? fetch;

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.sync(() => EventId.make(randomUUID()));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const requireSession = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const ctx = sessions.get(threadId);
        if (!ctx || ctx.stopped) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        return ctx;
      });

    const startSession: FenixAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const createdAt = yield* nowIso;
        const selectedModel =
          input.modelSelection?.instanceId === boundInstanceId
            ? input.modelSelection.model
            : settings.featuredModel;
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          model: selectedModel,
          threadId: input.threadId,
          createdAt,
          updatedAt: createdAt,
        };

        sessions.set(input.threadId, { session, turns: [], stopped: false });
        yield* offerRuntimeEvent({
          type: "session.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          payload: { message: "Fenix session started." },
        });
        yield* offerRuntimeEvent({
          type: "session.state.changed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          payload: { state: "ready", reason: "Fenix paired session ready" },
        });
        yield* offerRuntimeEvent({
          type: "thread.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          payload: { providerThreadId: input.threadId },
        });
        return session;
      });

    const sendTurn: FenixAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        const text = input.input?.trim();
        if (!text) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text.",
          });
        }

        const turnId = TurnId.make(randomUUID());
        const model =
          input.modelSelection?.instanceId === boundInstanceId
            ? input.modelSelection.model
            : (ctx.session.model ?? settings.featuredModel);
        const updatedAt = yield* nowIso;
        ctx.session = {
          ...ctx.session,
          status: "running",
          activeTurnId: turnId,
          model,
          updatedAt,
        };
        yield* offerRuntimeEvent({
          type: "turn.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          turnId,
          payload: { model },
        });

        const requestUrl = resolveUrl(settings.baseUrl, settings.sendMessagePath);
        const responsePayload = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetchImpl(requestUrl, {
              method: "POST",
              headers: {
                accept: "application/json",
                "content-type": "application/json",
              },
              credentials: "include",
              body: encodeUnknownJsonString({
                message: text,
                model,
                isGenericChatLane: true,
                source: "fenix-code",
                threadId: input.threadId,
              }),
            });
            const contentType = response.headers.get("content-type") ?? "";
            const payload = contentType.includes("application/json")
              ? await response.json()
              : await response.text();
            if (!response.ok) {
              throw new Error(
                `HTTP ${response.status}: ${encodeUnknownJsonString(payload).slice(0, 500)}`,
              );
            }
            return payload;
          },
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "ChatModels/SendMessageWithOptions",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });

        const assistantText = extractAssistantText(responsePayload);
        if (assistantText.length > 0) {
          yield* offerRuntimeEvent({
            type: "content.delta",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            turnId,
            payload: { streamKind: "assistant_text", delta: assistantText },
          });
        }

        const completedAt = yield* nowIso;
        const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
        ctx.session = {
          ...readySession,
          status: "ready",
          updatedAt: completedAt,
        };
        ctx.turns = [
          ...ctx.turns,
          { id: turnId, items: [{ input: text, response: responsePayload }] },
        ];
        yield* offerRuntimeEvent({
          type: "turn.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          turnId,
          payload: { state: "completed", stopReason: "stop" },
        });
        return { threadId: input.threadId, turnId } satisfies ProviderTurnStartResult;
      }).pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            yield* offerRuntimeEvent({
              type: "runtime.error",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: input.threadId,
              payload: {
                class: "provider_error",
                message: error.message,
              },
            });
          }),
        ),
      );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn: () => Effect.void,
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      stopSession: (threadId) =>
        Effect.gen(function* () {
          const ctx = sessions.get(threadId);
          if (!ctx) return;
          ctx.stopped = true;
          ctx.session = {
            ...ctx.session,
            status: "closed",
            updatedAt: yield* nowIso,
          };
        }),
      listSessions: () =>
        Effect.succeed(
          Array.from(sessions.values())
            .filter((ctx) => !ctx.stopped)
            .map((ctx) => ctx.session),
        ),
      hasSession: (threadId) =>
        Effect.succeed(sessions.has(threadId) && !sessions.get(threadId)!.stopped),
      readThread: (threadId) =>
        requireSession(threadId).pipe(Effect.map((ctx) => ({ threadId, turns: ctx.turns }))),
      rollbackThread: (threadId, numTurns) =>
        requireSession(threadId).pipe(
          Effect.map((ctx) => {
            ctx.turns = ctx.turns.slice(0, Math.max(0, ctx.turns.length - numTurns));
            return { threadId, turns: ctx.turns };
          }),
        ),
      stopAll: () =>
        Effect.sync(() => {
          for (const ctx of sessions.values()) {
            ctx.stopped = true;
          }
          sessions.clear();
        }),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies FenixAdapterShape;
  });
}
