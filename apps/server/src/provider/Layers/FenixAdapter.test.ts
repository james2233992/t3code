import { describe, expect, it, vi } from "@effect/vitest";
import {
  FenixSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import {
  buildFenixOpenCodeConfig,
  buildIsolatedFenixOpenCodeEnvironment,
  wrapFenixOpenCodeAdapter,
} from "./FenixAdapter.ts";

const OPENCODE = ProviderDriverKind.make("opencode");
const FENIX = ProviderDriverKind.make("fenix");
const INSTANCE = ProviderInstanceId.make("fenix");
const EXTERNAL_MODEL = "groq/openai/gpt-oss-120b";
const INTERNAL_MODEL = "fenix/openai/gpt-oss-120b";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);

function settings() {
  return decodeFenixSettings({ enabled: true, featuredModel: EXTERNAL_MODEL });
}

function makeDelegate() {
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
    streamEvents: Stream.empty,
  };

  return { adapter, startSession, sendTurn, interruptTurn, stopSession, rollbackThread };
}

describe("FenixAdapter", () => {
  it("pins one provider/model and isolates OpenCode from project and user config", () => {
    const config = JSON.parse(
      buildFenixOpenCodeConfig("http://127.0.0.1:4567/v1", "local-only-secret"),
    ) as Record<string, unknown>;
    const environment = buildIsolatedFenixOpenCodeEnvironment(
      "/Users/test/.fenix-code/runtime/opencode-fenix",
      JSON.stringify(config),
    );

    expect(config).toMatchObject({
      model: INTERNAL_MODEL,
      small_model: INTERNAL_MODEL,
      enabled_providers: ["fenix"],
      autoupdate: false,
      share: "disabled",
      plugin: [],
      mcp: {},
    });
    expect(Object.keys(config.provider as Record<string, unknown>)).toEqual(["fenix"]);
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

  it.effect("presents only Agent 9 Groq while delegating local tool execution to OpenCode", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
      });
      const threadId = ThreadId.make("thread-fenix-agent-9");

      const session = yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        cwd: "/Users/test/project",
      });
      const result = yield* adapter.sendTurn({ threadId, input: "edita README.md" });

      expect(adapter.provider).toBe(FENIX);
      expect(session).toMatchObject({
        provider: FENIX,
        providerInstanceId: INSTANCE,
        model: EXTERNAL_MODEL,
        cwd: "/Users/test/project",
      });
      expect(result.turnId).toBe(TurnId.make(`turn-${threadId}`));
      expect(delegate.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/Users/test/project",
          modelSelection: expect.objectContaining({
            instanceId: INSTANCE,
            model: INTERNAL_MODEL,
          }),
        }),
      );
      expect(delegate.sendTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          input: "edita README.md",
          modelSelection: expect.objectContaining({
            instanceId: INSTANCE,
            model: INTERNAL_MODEL,
          }),
        }),
      );
    }),
  );

  it.effect("fails closed for every model except the exact Agent 9 Groq model", () =>
    Effect.gen(function* () {
      const delegate = makeDelegate();
      const adapter = wrapFenixOpenCodeAdapter({
        settings: settings(),
        instanceId: INSTANCE,
        delegate: delegate.adapter,
      });
      const threadId = ThreadId.make("thread-fenix-wrong-model");

      const error = yield* adapter
        .startSession({
          threadId,
          runtimeMode: "full-access",
          modelSelection: {
            instanceId: INSTANCE,
            model: "xai/grok-4.5",
            options: [],
          },
        })
        .pipe(Effect.flip);

      expect(error._tag).toBe("ProviderAdapterValidationError");
      expect(error.message).toContain(EXTERNAL_MODEL);
      expect(delegate.startSession).not.toHaveBeenCalled();
    }),
  );

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
