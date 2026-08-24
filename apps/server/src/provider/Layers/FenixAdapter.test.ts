import { describe, expect, it, vi } from "@effect/vitest";
import {
  FenixSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  buildFenixOpenCodeConfig,
  buildIsolatedFenixOpenCodeEnvironment,
  fallbackFenixCodeModelCatalog,
  isCanonicalFenixModel,
  normalizeFenixCodeModelCatalog,
  type FenixCodeModelCatalog,
  type FenixModelEntitlement,
  wrapFenixOpenCodeAdapter,
} from "./FenixAdapter.ts";

const OPENCODE = ProviderDriverKind.make("opencode");
const FENIX = ProviderDriverKind.make("fenix");
const INSTANCE = ProviderInstanceId.make("fenix");
const EXTERNAL_MODEL = "groq/openai/gpt-oss-120b";
const OPENAI_MODEL = "openai/gpt-5.2-codex";
const INTERNAL_OPENAI_MODEL = `fenix/${OPENAI_MODEL}`;

const decodeFenixSettings = Schema.decodeSync(FenixSettings);

function settings(overrides: Record<string, unknown> = {}) {
  return decodeFenixSettings({ enabled: true, featuredModel: EXTERNAL_MODEL, ...overrides });
}

function selectableCatalog(): FenixCodeModelCatalog {
  return {
    canSelectModels: true,
    providers: [
      {
        providerSlug: "groq",
        displayName: "Groq",
        models: ["openai/gpt-oss-120b"],
        isDefault: false,
      },
      {
        providerSlug: "openai",
        displayName: "OpenAI",
        models: ["gpt-5.2-codex"],
        isDefault: true,
      },
    ],
  };
}

function filteredCatalog(): FenixCodeModelCatalog {
  return {
    canSelectModels: true,
    providers: [
      {
        providerSlug: "anthropic",
        displayName: "Anthropic",
        models: ["claude-sonnet-4-6"],
        isDefault: false,
      },
    ],
  };
}

function entitlement(modelCatalog: FenixCodeModelCatalog): FenixModelEntitlement {
  return {
    session: { kind: "bearer", token: "fenix-pairing-token" },
    modelCatalog,
  };
}

function makeDelegate(events: ReadonlyArray<ProviderRuntimeEvent> = []) {
  const sessions = new Map<ThreadId, ProviderSession>();
  const startSession = vi.fn((input: ProviderSessionStartInput) =>
    Effect.sync(() => {
      const session: ProviderSession = {
        provider: OPENCODE,
        providerInstanceId: input.modelSelection?.instanceId,
        model: input.modelSelection?.model,
        status: "ready",
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        resumeCursor: input.resumeCursor ?? { opaque: `resume-${input.threadId}` },
        cwd: input.cwd ?? "/tmp/fenix-project",
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
      };
      sessions.set(input.threadId, session);
      return session;
    }),
  );
  const sendTurn = vi.fn((input: ProviderSendTurnInput) =>
    Effect.succeed({
      threadId: input.threadId,
      turnId: TurnId.make(`turn-${input.threadId}`),
    }),
  );
  const interruptTurn = vi.fn(() => Effect.void);
  const stopSession = vi.fn((threadId: ThreadId) =>
    Effect.sync(() => {
      sessions.delete(threadId);
    }),
  );
  const rollbackThread = vi.fn((threadId: ThreadId, _numTurns: number) =>
    Effect.succeed({ threadId, turns: [] as const }),
  );

  const adapter: ProviderAdapterShape<ProviderAdapterError> = {
    provider: OPENCODE,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest: () => Effect.void,
    respondToUserInput: () => Effect.void,
    stopSession,
    listSessions: () => Effect.succeed(Array.from(sessions.values())),
    hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
    readThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
    rollbackThread,
    stopAll: () =>
      Effect.sync(() => {
        sessions.clear();
      }),
    streamEvents: Stream.fromIterable(events),
  };

  return { adapter, startSession, sendTurn, interruptTurn, stopSession, rollbackThread };
}

describe("FenixAdapter", () => {
  it("collapses a selectable catalog with no eligible models to the exact fallback", () => {
    const normalized = normalizeFenixCodeModelCatalog(filteredCatalog());

    expect(normalized).toBe(fallbackFenixCodeModelCatalog());
    expect(normalized).toEqual({
      canSelectModels: false,
      providers: [
        {
          providerSlug: "groq",
          displayName: "Groq",
          models: ["openai/gpt-oss-120b"],
          isDefault: true,
        },
      ],
    });
  });

  it("collapses a Groq-only selectable claim to the non-selectable exact fallback", () => {
    const normalized = normalizeFenixCodeModelCatalog({
      canSelectModels: true,
      providers: [
        {
          providerSlug: "groq",
          displayName: "Groq",
          models: ["openai/gpt-oss-120b"],
          isDefault: false,
        },
      ],
    });

    expect(normalized).toBe(fallbackFenixCodeModelCatalog());
    expect(normalized).toEqual({
      canSelectModels: false,
      providers: [
        {
          providerSlug: "groq",
          displayName: "Groq",
          models: ["openai/gpt-oss-120b"],
          isDefault: true,
        },
      ],
    });
  });

  it("preserves valid OpenAI catalogs with and without an existing Groq fallback", () => {
    const openAiOnly: FenixCodeModelCatalog = {
      canSelectModels: true,
      providers: [
        {
          providerSlug: "openai",
          displayName: "OpenAI",
          models: ["gpt-5.2-codex"],
          isDefault: true,
        },
      ],
    };

    expect(normalizeFenixCodeModelCatalog(openAiOnly)).toEqual(openAiOnly);
    expect(normalizeFenixCodeModelCatalog(selectableCatalog())).toEqual(selectableCatalog());
  });

  it.effect("treats an all-filtered entitlement as the stable fallback runtime catalog", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
        initialCatalog: fallbackFenixCodeModelCatalog(),
        resolveEntitlement: () => Effect.succeed(entitlement(filteredCatalog())),
      });
      const threadId = ThreadId.make("thread-fenix-filtered-entitlement");

      const session = yield* adapter.startSession({ threadId, runtimeMode: "full-access" });

      expect(session.model).toBe(EXTERNAL_MODEL);
      expect(delegate.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          modelSelection: expect.objectContaining({
            instanceId: INSTANCE,
            model: `fenix/${EXTERNAL_MODEL}`,
          }),
        }),
      );
    }),
  );

  it.effect("accepts only the forced fallback when model selection is disabled", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
        initialCatalog: fallbackFenixCodeModelCatalog(),
        resolveEntitlement: () => Effect.succeed(entitlement(fallbackFenixCodeModelCatalog())),
      });

      const session = yield* adapter.startSession({
        threadId: ThreadId.make("thread-fenix-forced-fallback"),
        runtimeMode: "full-access",
        modelSelection: { instanceId: INSTANCE, model: EXTERNAL_MODEL, options: [] },
      });
      const denied = yield* adapter
        .startSession({
          threadId: ThreadId.make("thread-fenix-denied-openai"),
          runtimeMode: "full-access",
          modelSelection: { instanceId: INSTANCE, model: OPENAI_MODEL, options: [] },
        })
        .pipe(Effect.flip);

      expect(session.model).toBe(EXTERNAL_MODEL);
      expect(denied.message).toContain("not available");
      expect(delegate.startSession).toHaveBeenCalledTimes(1);
    }),
  );

  it("builds dynamic OpenCode config and isolates it from project and user config", () => {
    const config = JSON.parse(
      buildFenixOpenCodeConfig(
        "http://127.0.0.1:4567/v1",
        "local-only-secret",
        selectableCatalog(),
      ),
    ) as Record<string, unknown>;
    const environment = buildIsolatedFenixOpenCodeEnvironment(
      "/Users/test/.fenix-code/runtime/opencode-fenix",
      JSON.stringify(config),
    );

    expect(config).toMatchObject({
      model: INTERNAL_OPENAI_MODEL,
      small_model: INTERNAL_OPENAI_MODEL,
      enabled_providers: ["fenix"],
      autoupdate: false,
      share: "disabled",
      plugin: [],
      mcp: {},
    });
    expect(Object.keys(config.provider as Record<string, unknown>)).toEqual(["fenix"]);
    const provider = (config.provider as Record<string, Record<string, unknown>>).fenix!;
    expect(Object.keys(provider.models as Record<string, unknown>)).toEqual([
      EXTERNAL_MODEL,
      OPENAI_MODEL,
    ]);
    expect(environment).toMatchObject({
      XDG_CONFIG_HOME: "/Users/test/.fenix-code/runtime/opencode-fenix/config",
      XDG_DATA_HOME: "/Users/test/.fenix-code/runtime/opencode-fenix/data",
      XDG_STATE_HOME: "/Users/test/.fenix-code/runtime/opencode-fenix/state",
      XDG_CACHE_HOME: "/Users/test/.fenix-code/runtime/opencode-fenix/cache",
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_DISABLE_CLAUDE_CODE: "true",
      OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_AUTO_SHARE: "false",
    });
    expect(environment.OPENCODE_CONFIG).toBeUndefined();
    expect(environment.OPENCODE_PERMISSION).toBeUndefined();
  });

  it.effect("preserves an entitled OpenAI model across start and implicit send", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
        initialCatalog: selectableCatalog(),
        resolveEntitlement: () => Effect.succeed(entitlement(selectableCatalog())),
      });
      const threadId = ThreadId.make("thread-fenix-agent-9");

      const session = yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        cwd: "/Users/test/project",
        modelSelection: { instanceId: INSTANCE, model: OPENAI_MODEL, options: [] },
      });
      const result = yield* adapter.sendTurn({ threadId, input: "edita README.md" });

      expect(adapter.provider).toBe(FENIX);
      expect(session).toMatchObject({
        provider: FENIX,
        providerInstanceId: INSTANCE,
        model: OPENAI_MODEL,
        cwd: "/Users/test/project",
      });
      expect(result.turnId).toBe(TurnId.make(`turn-${threadId}`));
      expect(delegate.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/Users/test/project",
          modelSelection: expect.objectContaining({
            instanceId: INSTANCE,
            model: INTERNAL_OPENAI_MODEL,
          }),
        }),
      );
      expect(delegate.sendTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          input: "edita README.md",
          modelSelection: expect.objectContaining({
            instanceId: INSTANCE,
            model: INTERNAL_OPENAI_MODEL,
          }),
        }),
      );
    }),
  );

  it.effect("denies Claude, Gemini, xAI and unavailable OpenAI models", () =>
    Effect.gen(function* () {
      for (const model of [
        "anthropic/claude-sonnet-4-6",
        "google/gemini-3-pro",
        "xai/grok-4.5",
        "openai/gpt-5.3-codex",
        ` ${OPENAI_MODEL}`,
      ]) {
        const delegate = makeDelegate();
        const adapter = wrapFenixOpenCodeAdapter({
          settings: settings(),
          instanceId: INSTANCE,
          delegate: delegate.adapter,
          initialCatalog: selectableCatalog(),
          resolveEntitlement: () => Effect.succeed(entitlement(selectableCatalog())),
        });
        const error = yield* adapter
          .startSession({
            threadId: ThreadId.make(`thread-denied-${model}`),
            runtimeMode: "full-access",
            modelSelection: {
              instanceId: INSTANCE,
              model,
              options: [],
            },
          })
          .pipe(Effect.flip);

        expect(error._tag, model).toBe("ProviderAdapterValidationError");
        expect(error.message, model).toContain("not available");
        expect(delegate.startSession, model).not.toHaveBeenCalled();
      }
    }),
  );

  it.effect("preserves the real OpenAI model in events and session listings", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-fenix-openai-events");
      const delegate = makeDelegate([
        {
          eventId: "event-fenix-openai",
          provider: OPENCODE,
          providerInstanceId: INSTANCE,
          threadId,
          turnId: TurnId.make("turn-fenix-openai"),
          createdAt: "2026-08-24T00:00:00.000Z",
          type: "turn.started",
          payload: { model: INTERNAL_OPENAI_MODEL },
        } as ProviderRuntimeEvent,
      ]);
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
        initialCatalog: selectableCatalog(),
        resolveEntitlement: () => Effect.succeed(entitlement(selectableCatalog())),
      });

      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: { instanceId: INSTANCE, model: OPENAI_MODEL, options: [] },
      });
      const sessions = yield* adapter.listSessions();
      const event = Option.getOrThrow(yield* Stream.runHead(adapter.streamEvents));

      expect(sessions[0]?.model).toBe(OPENAI_MODEL);
      expect(event.provider).toBe(FENIX);
      expect(event.type).toBe("turn.started");
      if (event.type === "turn.started") expect(event.payload.model).toBe(OPENAI_MODEL);
    }),
  );

  it.effect("does not let featuredModel or customModels widen the pairing catalog", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings({
          featuredModel: "openai/settings-featured",
          customModels: ["openai/settings-custom", "anthropic/claude-sonnet-4-6"],
        }),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
        initialCatalog: fallbackFenixCodeModelCatalog(),
        resolveEntitlement: () => Effect.succeed(entitlement(fallbackFenixCodeModelCatalog())),
      });

      const error = yield* adapter
        .startSession({
          threadId: ThreadId.make("thread-settings-no-widening"),
          runtimeMode: "full-access",
          modelSelection: {
            instanceId: INSTANCE,
            model: "openai/settings-custom",
            options: [],
          },
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("ProviderAdapterValidationError");
      expect(delegate.startSession).not.toHaveBeenCalled();
    }),
  );

  it.effect("revalidates expiry and rejects stale runtime catalogs on every send", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      let current: FenixModelEntitlement | null = entitlement(selectableCatalog());
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
        initialCatalog: selectableCatalog(),
        resolveEntitlement: () => Effect.succeed(current),
      });
      const threadId = ThreadId.make("thread-fenix-entitlement-refresh");

      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        modelSelection: { instanceId: INSTANCE, model: OPENAI_MODEL, options: [] },
      });

      current = null;
      const expired = yield* adapter.sendTurn({ threadId, input: "expired" }).pipe(Effect.flip);
      expect(expired.message).toContain("pairing is not active");

      current = entitlement(fallbackFenixCodeModelCatalog());
      const removed = yield* adapter
        .sendTurn({ threadId, input: "removed from catalog" })
        .pipe(Effect.flip);
      expect(removed.message).toContain("model catalog changed");
      expect(delegate.sendTurn).not.toHaveBeenCalled();
    }),
  );

  it.effect("rejects newly entitled models until the OpenCode runtime catalog is rebuilt", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      let current: FenixModelEntitlement = entitlement(fallbackFenixCodeModelCatalog());
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
        initialCatalog: fallbackFenixCodeModelCatalog(),
        resolveEntitlement: () => Effect.succeed(current),
      });
      const existingThreadId = ThreadId.make("thread-fenix-fallback-runtime");

      yield* adapter.startSession({
        threadId: existingThreadId,
        runtimeMode: "full-access",
        modelSelection: { instanceId: INSTANCE, model: EXTERNAL_MODEL, options: [] },
      });
      current = entitlement(selectableCatalog());

      const startError = yield* adapter
        .startSession({
          threadId: ThreadId.make("thread-fenix-new-entitlement"),
          runtimeMode: "full-access",
          modelSelection: { instanceId: INSTANCE, model: OPENAI_MODEL, options: [] },
        })
        .pipe(Effect.flip);
      const sendError = yield* adapter
        .sendTurn({
          threadId: existingThreadId,
          input: "use the newly entitled model",
          modelSelection: { instanceId: INSTANCE, model: OPENAI_MODEL, options: [] },
        })
        .pipe(Effect.flip);

      expect(startError.message).toContain("model catalog changed");
      expect(sendError.message).toContain("model catalog changed");
      expect(delegate.startSession).toHaveBeenCalledTimes(1);
      expect(delegate.sendTurn).not.toHaveBeenCalled();
    }),
  );

  it("recognizes only clean canonical Fenix model forms for the websocket boundary", () => {
    expect(isCanonicalFenixModel(EXTERNAL_MODEL)).toBe(true);
    expect(isCanonicalFenixModel(OPENAI_MODEL)).toBe(true);
    expect(isCanonicalFenixModel("openai/gpt-5.2-codex\n")).toBe(false);
    expect(isCanonicalFenixModel("anthropic/claude-sonnet-4-6")).toBe(false);
    expect(isCanonicalFenixModel("google/gemini-3-pro")).toBe(false);
    expect(isCanonicalFenixModel("xai/grok-4.5")).toBe(false);
  });

  it.effect("fails closed when model selection targets another provider instance", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
      });
      const threadId = ThreadId.make("thread-fenix-wrong-instance");

      const error = yield* adapter
        .startSession({
          threadId,
          runtimeMode: "full-access",
          modelSelection: {
            instanceId: ProviderInstanceId.make("another-instance"),
            model: EXTERNAL_MODEL,
            options: [],
          },
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("ProviderAdapterValidationError");
      expect(error.message).toContain(String(INSTANCE));
      expect(delegate.startSession).not.toHaveBeenCalled();
    }),
  );

  it.effect("preserves cancel, thread reads, rollback, stop and reconnect session state", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
      });
      const threadId = ThreadId.make("thread-fenix-lifecycle");
      const turnId = TurnId.make("turn-fenix-lifecycle");

      yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
      expect(yield* adapter.hasSession(threadId)).toBe(true);
      expect((yield* adapter.listSessions())[0]).toMatchObject({
        provider: FENIX,
        model: EXTERNAL_MODEL,
      });
      yield* adapter.interruptTurn(threadId, turnId);
      expect((yield* adapter.readThread(threadId)).threadId).toBe(threadId);
      expect((yield* adapter.rollbackThread(threadId, 1)).threadId).toBe(threadId);
      yield* adapter.stopSession(threadId);
      expect(yield* adapter.hasSession(threadId)).toBe(false);

      expect(delegate.interruptTurn).toHaveBeenCalledWith(threadId, turnId);
      expect(delegate.rollbackThread).toHaveBeenCalledWith(threadId, 1);
      expect(delegate.stopSession).toHaveBeenCalledWith(threadId);
    }),
  );
});
