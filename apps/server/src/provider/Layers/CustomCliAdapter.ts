import * as NodeCrypto from "node:crypto";

import {
  EventId,
  type CustomCliSettings,
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
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  ProviderAdapterProcessError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { collectStreamAsString } from "../providerSnapshot.ts";
import type { CustomCliAdapterShape } from "../Services/CustomCliAdapter.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { CUSTOM_CLI_DRIVER_KIND, validateCustomCliTemplate } from "./CustomCliPolicy.ts";

const PROVIDER_NAME = "customCli";

interface CustomCliSessionContext {
  session: ProviderSession;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  stopped: boolean;
}

export interface CustomCliAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
}

export function makeCustomCliAdapter(
  settings: CustomCliSettings,
  options?: CustomCliAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("customCli");
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const sessions = new Map<ThreadId, CustomCliSessionContext>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.sync(() => EventId.make(NodeCrypto.randomUUID()));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });
    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const requireTemplate = (operation: string) =>
      Effect.gen(function* () {
        const validation = validateCustomCliTemplate(settings);
        if (validation.ok && validation.template) return validation.template;
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER_NAME,
          operation,
          issue: validation.issue ?? "Invalid custom CLI template.",
        });
      });

    const requireSession = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const ctx = sessions.get(threadId);
        if (!ctx || ctx.stopped) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER_NAME,
            threadId,
          });
        }
        return ctx;
      });

    const startSession: CustomCliAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const template = yield* requireTemplate("startSession");
        const createdAt = yield* nowIso;
        const selectedModel =
          input.modelSelection?.instanceId === boundInstanceId
            ? input.modelSelection.model.trim()
            : template.modelSlug;
        const session: ProviderSession = {
          provider: CUSTOM_CLI_DRIVER_KIND,
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
          provider: CUSTOM_CLI_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          payload: { message: "Custom CLI session started." },
        });
        yield* offerRuntimeEvent({
          type: "session.state.changed",
          ...(yield* makeEventStamp()),
          provider: CUSTOM_CLI_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          payload: { state: "ready", reason: "Custom CLI template validated locally." },
        });
        yield* offerRuntimeEvent({
          type: "thread.started",
          ...(yield* makeEventStamp()),
          provider: CUSTOM_CLI_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          payload: { providerThreadId: input.threadId },
        });
        return session;
      });

    const sendTurn: CustomCliAdapterShape["sendTurn"] = (input) => {
      let activeTurnId: TurnId | undefined;
      let activeContext: CustomCliSessionContext | undefined;
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
            provider: CUSTOM_CLI_DRIVER_KIND,
            providerInstanceId: boundInstanceId,
            threadId: input.threadId,
            turnId: activeTurnId,
            payload: { state: "failed", errorMessage: error.message },
          });
        });

      return Effect.gen(function* () {
        const template = yield* requireTemplate("sendTurn");
        const ctx = yield* requireSession(input.threadId);
        const text = input.input?.trim();
        if (!text) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER_NAME,
            operation: "sendTurn",
            issue: "Turn requires non-empty text.",
          });
        }
        if (ctx.session.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER_NAME,
            operation: "sendTurn",
            issue: "Custom CLI session already has an active turn.",
          });
        }

        const turnId = TurnId.make(NodeCrypto.randomUUID());
        activeTurnId = turnId;
        activeContext = ctx;
        const model =
          input.modelSelection?.instanceId === boundInstanceId
            ? input.modelSelection.model.trim()
            : (ctx.session.model ?? template.modelSlug);
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
          provider: CUSTOM_CLI_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          turnId,
          payload: { model },
        });

        const [stdout, stderr, exitCode] = yield* Effect.scoped(
          Effect.gen(function* () {
            const child = yield* childProcessSpawner
              .spawn(
                ChildProcess.make(template.binaryPath, template.args, {
                  ...(ctx.session.cwd ? { cwd: ctx.session.cwd } : {}),
                  env: mergeProviderInstanceEnvironment(template.env, options?.environment),
                  extendEnv: true,
                  shell: false,
                  stdin: {
                    stream: Stream.encodeText(Stream.make(text)),
                  },
                }),
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterProcessError({
                      provider: PROVIDER_NAME,
                      threadId: input.threadId,
                      detail: "Failed to spawn custom CLI agent.",
                      cause,
                    }),
                ),
              );
            return yield* Effect.all(
              [
                collectStreamAsString(child.stdout),
                collectStreamAsString(child.stderr),
                child.exitCode.pipe(Effect.map(Number)),
              ],
              { concurrency: "unbounded" },
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterProcessError({
                    provider: PROVIDER_NAME,
                    threadId: input.threadId,
                    detail: "Failed to read custom CLI agent output.",
                    cause,
                  }),
              ),
            );
          }),
        );
        if (exitCode !== 0) {
          return yield* new ProviderAdapterProcessError({
            provider: PROVIDER_NAME,
            threadId: input.threadId,
            detail: `Custom CLI agent exited with code ${exitCode}.`,
          });
        }

        const assistantText = stdout.trim() || stderr.trim();
        if (assistantText.length > 0) {
          yield* offerRuntimeEvent({
            type: "content.delta",
            ...(yield* makeEventStamp()),
            provider: CUSTOM_CLI_DRIVER_KIND,
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
        ctx.turns = [...ctx.turns, { id: turnId, items: [{ input: text, stdout, stderr }] }];
        yield* offerRuntimeEvent({
          type: "turn.completed",
          ...(yield* makeEventStamp()),
          provider: CUSTOM_CLI_DRIVER_KIND,
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
              provider: CUSTOM_CLI_DRIVER_KIND,
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
      provider: CUSTOM_CLI_DRIVER_KIND,
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
    } satisfies CustomCliAdapterShape;
  });
}
