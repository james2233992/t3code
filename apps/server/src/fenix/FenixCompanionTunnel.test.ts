import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";

import {
  decodeFenixCompanionBrokerPayload,
  encodeFenixCompanionBrokerFrame,
  keepFenixCompanionSessionsAlive,
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
      yield* Deferred.await(secondSessionStarted);

      expect(yield* Ref.get(attempts)).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
  );
});
