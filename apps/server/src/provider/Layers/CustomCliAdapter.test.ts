import { describe, expect, it } from "@effect/vitest";
import {
  CustomCliSettings,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ProviderAdapterProcessError, ProviderAdapterValidationError } from "../Errors.ts";
import { makeCustomCliAdapter } from "./CustomCliAdapter.ts";
import { validateCustomCliTemplate } from "./CustomCliPolicy.ts";

const encoder = new TextEncoder();
const decodeCustomCliSettings = Schema.decodeSync(CustomCliSettings);

const customCliSettings = (overrides: Partial<CustomCliSettings> = {}) =>
  decodeCustomCliSettings({
    enabled: true,
    name: "Fake Agent",
    binaryPath: "fake-agent",
    args: ["--mode", "chat"],
    allowedBinaries: ["fake-agent"],
    modelSlug: "custom-cli/fake-agent",
    ...overrides,
  });

function mockHandle(result: { stdout: string; stderr: string; code: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function recordingSpawnerLayer(result: { stdout: string; stderr: string; code: number }) {
  const commands: Array<{
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly options?: { readonly shell?: boolean; readonly env?: NodeJS.ProcessEnv };
  }> = [];
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const recorded = command as unknown as {
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly options?: { readonly shell?: boolean; readonly env?: NodeJS.ProcessEnv };
      };
      commands.push(recorded);
      return Effect.succeed(mockHandle(result));
    }),
  );
  return { layer, commands };
}

const expectValidationFailure = (settings: CustomCliSettings, issue: RegExp) =>
  Effect.gen(function* () {
    const { layer, commands } = recordingSpawnerLayer({ stdout: "unused", stderr: "", code: 0 });
    const exit = yield* makeCustomCliAdapter(settings, {
      instanceId: ProviderInstanceId.make("custom_agent"),
    }).pipe(
      Effect.flatMap((adapter) =>
        adapter.startSession({
          threadId: ThreadId.make("thread-custom-invalid"),
          runtimeMode: "auto",
        }),
      ),
      Effect.exit,
      Effect.provide(layer),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(exit.cause.toString()).toMatch(issue);
    }
    expect(commands).toHaveLength(0);
  });

describe("CustomCliAdapter", () => {
  it.effect("runs a local template through argv without a shell", () =>
    Effect.gen(function* () {
      const { layer, commands } = recordingSpawnerLayer({
        stdout: "respuesta local",
        stderr: "",
        code: 0,
      });
      const adapter = yield* makeCustomCliAdapter(
        customCliSettings({
          env: [{ name: "CUSTOM_AGENT_MODE", value: "test", sensitive: false }],
        }),
        {
          instanceId: ProviderInstanceId.make("custom_agent"),
          environment: { BASE_ENV: "1" },
        },
      ).pipe(Effect.provide(layer));
      const threadId = ThreadId.make("thread-custom-cli");
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.take(6),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* adapter.startSession({ threadId, runtimeMode: "auto", cwd: "/tmp/fenix-code" });
      const result = yield* adapter.sendTurn({ threadId, input: "hola" });
      const events = Array.from(yield* Fiber.join(eventsFiber)) as ProviderRuntimeEvent[];
      const thread = yield* adapter.readThread(threadId);

      expect(result.threadId).toBe(threadId);
      expect(commands).toHaveLength(1);
      expect(commands[0]?.command).toBe("fake-agent");
      expect(commands[0]?.args).toEqual(["--mode", "chat"]);
      expect(commands[0]?.options?.shell).toBe(false);
      expect(commands[0]?.options?.env).toMatchObject({
        BASE_ENV: "1",
        CUSTOM_AGENT_MODE: "test",
      });
      expect(events.map((event) => event.type)).toEqual([
        "session.started",
        "session.state.changed",
        "thread.started",
        "turn.started",
        "content.delta",
        "turn.completed",
      ]);
      expect(events.find((event) => event.type === "content.delta")?.payload).toMatchObject({
        streamKind: "assistant_text",
        delta: "respuesta local",
      });
      expect(thread.turns).toHaveLength(1);
    }),
  );

  it.effect("rejects a binary that is not allowlisted before spawning", () =>
    expectValidationFailure(
      customCliSettings({ binaryPath: "not-allowed", allowedBinaries: [] }),
      /not allowlisted/,
    ),
  );

  it.effect("rejects wildcards in local allowlist extensions", () =>
    expectValidationFailure(
      customCliSettings({ allowedBinaries: ["fake-*"] }),
      /Allowed binaries must be exact/,
    ),
  );

  it.effect("rejects dangerous flags unless the template opts in", () =>
    Effect.gen(function* () {
      yield* expectValidationFailure(
        customCliSettings({ args: ["--dangerously-skip-approvals"] }),
        /Dangerous flag/,
      );
      expect(
        validateCustomCliTemplate(
          customCliSettings({
            args: ["--dangerously-skip-approvals"],
            allowDangerousFlags: true,
          }),
        ).ok,
      ).toBe(true);
    }),
  );

  it.effect("rejects shell/control injection in template name args and env", () =>
    Effect.gen(function* () {
      yield* expectValidationFailure(customCliSettings({ name: "Fake;Agent" }), /Template name/);
      yield* expectValidationFailure(customCliSettings({ args: ["--safe;rm"] }), /args contain/);
      yield* expectValidationFailure(
        customCliSettings({ env: [{ name: "BAD_ENV", value: "one\ntwo", sensitive: false }] }),
        /env values/,
      );
    }),
  );

  it.effect("terminalizes a failed child process and restores the session", () =>
    Effect.gen(function* () {
      const { layer } = recordingSpawnerLayer({ stdout: "", stderr: "boom", code: 2 });
      const adapter = yield* makeCustomCliAdapter(customCliSettings(), {
        instanceId: ProviderInstanceId.make("custom_agent"),
      }).pipe(Effect.provide(layer));
      const threadId = ThreadId.make("thread-custom-cli-fail");
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.take(6),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* adapter.startSession({ threadId, runtimeMode: "auto" });
      const exit = yield* adapter.sendTurn({ threadId, input: "hola" }).pipe(Effect.exit);
      const sessions = yield* adapter.listSessions();
      const events = Array.from(yield* Fiber.join(eventsFiber)) as ProviderRuntimeEvent[];

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(exit.cause.toString()).toContain(ProviderAdapterProcessError.name);
      }
      expect(sessions[0]).toMatchObject({
        status: "ready",
        lastError: expect.stringContaining("exited with code 2"),
      });
      expect(events.find((event) => event.type === "turn.completed")).toMatchObject({
        type: "turn.completed",
        payload: { state: "failed" },
      });
    }),
  );

  it.effect("rejects concurrent turns on the same session", () =>
    Effect.gen(function* () {
      const exitCode = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      const layer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() =>
          Effect.succeed(
            ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Deferred.await(exitCode),
              isRunning: Effect.succeed(true),
              kill: () => Effect.void,
              unref: Effect.succeed(Effect.void),
              stdin: Sink.drain,
              stdout: Stream.make(encoder.encode("slow")),
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            }),
          ),
        ),
      );
      const adapter = yield* makeCustomCliAdapter(customCliSettings(), {
        instanceId: ProviderInstanceId.make("custom_agent"),
      }).pipe(Effect.provide(layer));
      const threadId = ThreadId.make("thread-custom-cli-busy");
      yield* adapter.startSession({ threadId, runtimeMode: "auto" });

      const first = yield* adapter.sendTurn({ threadId, input: "first" }).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const second = yield* adapter.sendTurn({ threadId, input: "second" }).pipe(Effect.exit);
      yield* Deferred.succeed(exitCode, ChildProcessSpawner.ExitCode(0));
      yield* Fiber.join(first);

      expect(second._tag).toBe("Failure");
      if (second._tag === "Failure") {
        expect(second.cause.toString()).toContain(ProviderAdapterValidationError.name);
        expect(second.cause.toString()).toContain("already has an active turn");
      }
    }),
  );
});
