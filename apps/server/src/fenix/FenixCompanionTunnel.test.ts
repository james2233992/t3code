import { describe, expect, it } from "@effect/vitest";

import {
  decodeFenixCompanionBrokerPayload,
  encodeFenixCompanionBrokerFrame,
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
});
