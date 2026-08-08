import * as NodeCrypto from "node:crypto";

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
import { normalizeModelSlug } from "@t3tools/shared/model";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { FenixAdapterShape } from "../Services/FenixAdapter.ts";

const PROVIDER = ProviderDriverKind.make("fenix");
const FENIX_TRUSTED_ORIGIN = "https://iaonline.io";
const DEFAULT_FENIX_MODEL = "groq/openai/gpt-oss-120b";
const INVALID_HEADER_VALUE = /[\u0000-\u001f\u007f\s]/;
const INVALID_COOKIE_VALUE = /[\u0000-\u001f\u007f\s;,]/;
const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

function normalizeFenixModel(model: string | null | undefined): string {
  return normalizeModelSlug(model, PROVIDER) ?? DEFAULT_FENIX_MODEL;
}

interface FenixSessionContext {
  session: ProviderSession;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  stopped: boolean;
}

export interface FenixAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly fetch?: typeof fetch;
  readonly pairingSession?: FenixPairingSession | FenixPairingSessionResolver;
}

export type FenixPairingSession =
  | {
      readonly kind: "cookie";
      readonly authToken: string;
    }
  | {
      readonly kind: "bearer";
      readonly token: string;
    };

export type FenixPairingSessionResolver = () => Effect.Effect<
  FenixPairingSession | null | undefined
>;

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

function validatePairingSession(
  session: FenixPairingSession | null | undefined,
): FenixPairingSession | null {
  if (!session) return null;
  switch (session.kind) {
    case "cookie": {
      return session.authToken.length > 0 && !INVALID_COOKIE_VALUE.test(session.authToken)
        ? { kind: session.kind, authToken: session.authToken }
        : null;
    }
    case "bearer": {
      return session.token.length > 0 && !INVALID_HEADER_VALUE.test(session.token)
        ? { kind: session.kind, token: session.token }
        : null;
    }
  }
}

function readPairingSession(
  input: FenixPairingSession | FenixPairingSessionResolver | undefined,
): Effect.Effect<FenixPairingSession | null> {
  return (typeof input === "function" ? input() : Effect.succeed(input)).pipe(
    Effect.map(validatePairingSession),
  );
}

function applyPairingSessionHeaders(
  headers: Record<string, string>,
  session: FenixPairingSession,
): Record<string, string> {
  if (session.kind === "cookie") {
    return { ...headers, cookie: `AuthToken=${session.authToken}` };
  }
  return { ...headers, authorization: `Bearer ${session.token}` };
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
    const resolveTrustedRequestUrl = () =>
      Effect.try({
        try: () => {
          const requestUrl = resolveUrl(settings.baseUrl, settings.sendMessagePath);
          const url = new URL(requestUrl);
          if (url.origin !== FENIX_TRUSTED_ORIGIN) {
            throw new Error(`Resolved origin ${url.origin} is not ${FENIX_TRUSTED_ORIGIN}.`);
          }
          return requestUrl;
        },
        catch: (cause) =>
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "pairing",
            issue: `Fenix pairing credentials can only be sent to ${FENIX_TRUSTED_ORIGIN}: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          }),
      });
    const readRequiredPairingSession = () =>
      readPairingSession(options?.pairingSession).pipe(
        Effect.flatMap((pairingSession) =>
          pairingSession
            ? Effect.succeed(pairingSession)
            : Effect.fail(
                new ProviderAdapterValidationError({
                  provider: PROVIDER,
                  operation: "pairing",
                  issue:
                    "Fenix provider requires an active Code Lab pairing session before calling the Fenix backend.",
                }),
              ),
        ),
      );

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.sync(() => EventId.make(NodeCrypto.randomUUID()));
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
            ? normalizeFenixModel(input.modelSelection.model)
            : normalizeFenixModel(settings.featuredModel);
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
          payload: {
            state: "ready",
            reason: "Fenix pairing checked on turn",
          },
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

    const sendTurn: FenixAdapterShape["sendTurn"] = (input) => {
      let activeTurnId: TurnId | undefined;
      let activeContext: FenixSessionContext | undefined;
      const failActiveTurn = (error: { readonly message: string }) =>
        Effect.gen(function* () {
          if (!activeTurnId || !activeContext) return;
          if (activeContext.session.activeTurnId !== activeTurnId) return;

          const failedAt = yield* nowIso;
          const { activeTurnId: _activeTurnId, ...readySession } = activeContext.session;
          activeContext.session = {
            ...readySession,
            status: "ready",
            updatedAt: failedAt,
            lastError: error.message,
          };
          yield* offerRuntimeEvent({
            type: "turn.completed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            turnId: activeTurnId,
            payload: { state: "failed", errorMessage: error.message },
          });
        });

      return Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        const text = input.input?.trim();
        if (!text) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text.",
          });
        }
        if (ctx.session.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Fenix session already has an active turn.",
          });
        }

        const pairingSession = yield* readRequiredPairingSession();
        const requestUrl = yield* resolveTrustedRequestUrl();
        const turnId = TurnId.make(NodeCrypto.randomUUID());
        activeTurnId = turnId;
        activeContext = ctx;
        const model =
          input.modelSelection?.instanceId === boundInstanceId
            ? normalizeFenixModel(input.modelSelection.model)
            : normalizeFenixModel(ctx.session.model ?? settings.featuredModel);
        const updatedAt = yield* nowIso;
        const { lastError: _lastError, ...runningSession } = ctx.session;
        ctx.session = {
          ...runningSession,
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

        const responsePayload = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetchImpl(requestUrl, {
              method: "POST",
              headers: applyPairingSessionHeaders(
                {
                  accept: "application/json",
                  "content-type": "application/json",
                },
                pairingSession,
              ),
              credentials: "include",
              body: encodeUnknownJsonString({
                message: text,
                model,
                isGenericChatLane: true,
                source: "fenix-code",
                threadId: input.threadId,
                turnId,
                requestId: turnId,
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
        const {
          activeTurnId: _activeTurnId,
          lastError: _completedLastError,
          ...readySession
        } = ctx.session;
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
            yield* failActiveTurn(error);
          }),
        ),
      );
    };

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
