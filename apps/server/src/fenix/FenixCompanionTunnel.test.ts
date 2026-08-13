// @effect-diagnostics-next-line nodeBuiltinImport:off - packaged-runtime detection is a filesystem boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - packaged-runtime fixture mirrors the installed path.
import * as NodePath from "node:path";
import { describe, expect, it, vi } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import {
  decodeFenixCompanionBrokerPayload,
  encodeFenixCompanionBrokerFrame,
  fetchFenixCompanionRuntimeTicket,
  FenixCompanionTunnelError,
  isPackagedFenixCompanionRuntime,
  isFenixPortalAuthorizationRequired,
  keepFenixCompanionSessionsAuthorized,
  keepFenixCompanionSessionsAlive,
  requireFenixCompanionStartupAuthorization,
} from "./FenixCompanionTunnel.ts";

describe("FenixCompanionTunnel broker framing", () => {
  it("wraps local RPC frames and unwraps only broker RPC envelopes", () => {
    const request = '{"_tag":"Request","id":1}';
    const response = '{"_tag":"Exit","requestId":1}';

    expect(encodeFenixCompanionBrokerFrame(request)).toBe(
      JSON.stringify({ type: "rpc.frame", payload: request }),
    );
    expect(
      decodeFenixCompanionBrokerPayload(JSON.stringify({ type: "rpc.frame", payload: response })),
    ).toBe(response);
    expect(
      decodeFenixCompanionBrokerPayload(
        JSON.stringify({ type: "peer.connected", tunnelId: "tunnel-1" }),
      ),
    ).toBeNull();
    expect(decodeFenixCompanionBrokerPayload("not-json")).toBeNull();
  });

  it("rejects unsupported and oversized frames in both directions", () => {
    const oversized = "x".repeat(128 * 1024 + 1);
    const emptyFrame = encodeFenixCompanionBrokerFrame("");
    expect(emptyFrame).not.toBeNull();
    const emptyFrameBytes = new TextEncoder().encode(emptyFrame ?? "").byteLength;
    const boundaryPayload = "x".repeat(128 * 1024 - emptyFrameBytes);
    const oversizedEnvelope = JSON.stringify({
      type: "rpc.frame",
      payload: "ok",
      padding: "x".repeat(128 * 1024 * 6 + 257),
    });

    expect(encodeFenixCompanionBrokerFrame(new Blob(["rpc"]))).toBeNull();
    expect(
      new TextEncoder().encode(encodeFenixCompanionBrokerFrame(boundaryPayload) ?? ""),
    ).toHaveLength(128 * 1024);
    expect(encodeFenixCompanionBrokerFrame(`${boundaryPayload}x`)).toBeNull();
    expect(encodeFenixCompanionBrokerFrame(oversized)).toBeNull();
    expect(
      decodeFenixCompanionBrokerPayload(JSON.stringify({ type: "rpc.frame", payload: oversized })),
    ).toBeNull();
    expect(decodeFenixCompanionBrokerPayload(oversizedEnvelope)).toBeNull();
  });

  it.effect("starts a replacement session after a clean rotation", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const secondSessionStarted = yield* Deferred.make<void>();
      const session = Ref.updateAndGet(attempts, (value) => value + 1).pipe(
        Effect.flatMap((attempt) =>
          attempt === 2
            ? Deferred.succeed(secondSessionStarted, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.void,
        ),
      );

      const fiber = yield* keepFenixCompanionSessionsAlive(session).pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      expect(yield* Ref.get(attempts)).toBe(1);
      yield* TestClock.adjust("1 second");
      yield* Deferred.await(secondSessionStarted);

      expect(yield* Ref.get(attempts)).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it("requires portal authorization only for explicitly packaged runtimes", () => {
    expect(isFenixPortalAuthorizationRequired("1", false)).toBe(true);
    expect(isFenixPortalAuthorizationRequired("0", true)).toBe(true);
    expect(isFenixPortalAuthorizationRequired("", false)).toBe(false);
    expect(isFenixPortalAuthorizationRequired(undefined, false)).toBe(false);
  });

  it("distinguishes the Fenix auth marker from a standard install receipt", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fenix-packaged-runtime-"));
    const entryPath = NodePath.join(root, "node_modules/t3/dist/bin.mjs");
    try {
      await NodeFSP.mkdir(NodePath.dirname(entryPath), { recursive: true });
      await NodeFSP.writeFile(entryPath, "export {};\n");
      await NodeFSP.writeFile(NodePath.join(root, ".install-complete"), "0.0.32\n");

      expect(isPackagedFenixCompanionRuntime(entryPath)).toBe(false);

      await NodeFSP.writeFile(NodePath.join(root, ".fenix-portal-auth-required"), "1\n");
      expect(isPackagedFenixCompanionRuntime(entryPath)).toBe(true);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("bounds a stalled portal ticket request with cancellation", async () => {
    let aborted = false;
    const fetchImpl = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("timed out", "AbortError"));
            },
            { once: true },
          );
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchFenixCompanionRuntimeTicket(
        {
          version: 1,
          portalOrigin: "https://iaonline.io",
          deviceId: "d".repeat(32),
          deviceName: "Fenix test device",
          deviceCredential: "c".repeat(43),
          allowedRoots: ["/tmp"],
        },
        { fetchImpl, timeoutMs: 5 },
      ),
    ).rejects.toThrow();
    expect(aborted).toBe(true);
  });

  it.effect("fails closed before listening when the packaged runtime is not paired", () =>
    Effect.gen(function* () {
      const suffix = yield* Random.nextInt;
      const exit = yield* Effect.exit(
        requireFenixCompanionStartupAuthorization(`/tmp/fenix-code-unpaired-${suffix}`, true),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          kind: "authorization",
        });
      }
    }),
  );

  it.effect("stops retrying when a required portal authorization is lost", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const losses = yield* Ref.make(0);
      const authorizationLost = yield* Deferred.make<void>();
      const session = Ref.update(attempts, (value) => value + 1).pipe(
        Effect.andThen(Effect.fail("revoked" as const)),
      );
      const onAuthorizationLoss = (_error: "revoked") =>
        Ref.update(losses, (value) => value + 1).pipe(
          Effect.andThen(Deferred.succeed(authorizationLost, undefined)),
          Effect.asVoid,
        );

      const fiber = yield* keepFenixCompanionSessionsAuthorized(session, onAuthorizationLoss).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(authorizationLost);
      yield* TestClock.adjust("1 minute");

      expect(yield* Ref.get(attempts)).toBe(1);
      expect(yield* Ref.get(losses)).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("stops a packaged runtime instead of leaving it usable offline", () =>
    Effect.gen(function* () {
      const failures = yield* Ref.make(0);
      const stopped = yield* Deferred.make<void>();
      const session = Effect.fail(
        new FenixCompanionTunnelError({
          message: "portal unavailable",
          kind: "transient",
        }),
      );
      const fiber = yield* keepFenixCompanionSessionsAuthorized(session, () =>
        Ref.update(failures, (value) => value + 1).pipe(
          Effect.andThen(Deferred.succeed(stopped, undefined)),
          Effect.asVoid,
        ),
      ).pipe(Effect.forkChild);

      yield* Deferred.await(stopped);
      yield* TestClock.adjust("1 minute");
      expect(yield* Ref.get(failures)).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );
});
