import { describe, expect, it } from "@effect/vitest";

import {
  decodeFenixBrokerFrame,
  encodeFenixBrokerFrame,
  FenixBrokerWebSocket,
} from "./fenixBrokerWebSocket.ts";

class TestWebSocket extends EventTarget {
  binaryType: BinaryType = "blob";
  readonly bufferedAmount = 0;
  readonly extensions = "";
  readonly protocol = "fenix-code-lab-v1";
  readyState = 1 as WebSocket["readyState"];
  readonly sent: unknown[] = [];
  readonly url = "wss://iaonline.io/code-lab/ws";

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close"));
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

describe("FenixBrokerWebSocket", () => {
  it("encapsulates outbound RPC frames and unwraps inbound RPC frames", () => {
    const underlying = new TestWebSocket();
    const socket = new FenixBrokerWebSocket(underlying as unknown as WebSocket);
    const received: unknown[] = [];
    socket.addEventListener("message", (event) => received.push((event as MessageEvent).data));

    socket.send('{"_tag":"Request","id":1}');
    underlying.receive(
      JSON.stringify({ type: "rpc.frame", payload: '{"_tag":"Exit","requestId":1}' }),
    );

    expect(underlying.sent).toEqual([
      JSON.stringify({ type: "rpc.frame", payload: '{"_tag":"Request","id":1}' }),
    ]);
    expect(received).toEqual(['{"_tag":"Exit","requestId":1}']);
  });

  it("does not expose broker control messages to the RPC client", () => {
    const underlying = new TestWebSocket();
    const socket = new FenixBrokerWebSocket(underlying as unknown as WebSocket);
    const received: unknown[] = [];
    socket.addEventListener("message", (event) => received.push((event as MessageEvent).data));

    underlying.receive(JSON.stringify({ type: "peer.connected", tunnelId: "tunnel-1" }));
    underlying.receive("not-json");

    expect(received).toEqual([]);
  });

  it("clones lifecycle events before forwarding them to the wrapper", () => {
    const underlying = new TestWebSocket();
    const socket = new FenixBrokerWebSocket(underlying as unknown as WebSocket);
    const source = new Event("open");
    let received: Event | undefined;
    socket.addEventListener("open", (event) => {
      received = event;
    });

    underlying.dispatchEvent(source);

    expect(received).toBeDefined();
    expect(received).not.toBe(source);
    expect(received?.target).toBe(socket);
  });

  it("rejects oversized outbound frames and ignores oversized inbound frames", () => {
    const oversized = "x".repeat(128 * 1024 + 1);
    const emptyFrameBytes = new TextEncoder().encode(encodeFenixBrokerFrame("")).byteLength;
    const boundaryPayload = "x".repeat(128 * 1024 - emptyFrameBytes);
    const oversizedEnvelope = JSON.stringify({
      type: "rpc.frame",
      payload: "ok",
      padding: "x".repeat(128 * 1024 * 6 + 257),
    });
    expect(new TextEncoder().encode(encodeFenixBrokerFrame(boundaryPayload))).toHaveLength(
      128 * 1024,
    );
    expect(() => encodeFenixBrokerFrame(`${boundaryPayload}x`)).toThrow(/too large/i);
    expect(() => encodeFenixBrokerFrame(oversized)).toThrow(/too large/i);
    expect(
      decodeFenixBrokerFrame(JSON.stringify({ type: "rpc.frame", payload: oversized })),
    ).toBeNull();
    expect(decodeFenixBrokerFrame(oversizedEnvelope)).toBeNull();
  });
});
