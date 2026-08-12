const BROKER_FRAME_TYPE = "rpc.frame";
const MAX_BROKER_MESSAGE_BYTES = 128 * 1024;
const MAX_BROKER_ENVELOPE_CHARS = MAX_BROKER_MESSAGE_BYTES * 6 + 256;

interface BrokerFrameEnvelope {
  readonly type: typeof BROKER_FRAME_TYPE;
  readonly payload: string;
}

export function encodeFenixBrokerFrame(data: string | ArrayBufferLike | ArrayBufferView): string {
  const payload =
    typeof data === "string"
      ? data
      : new TextDecoder().decode(
          ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data),
        );
  const frame = JSON.stringify({ type: BROKER_FRAME_TYPE, payload } satisfies BrokerFrameEnvelope);
  if (new TextEncoder().encode(frame).byteLength > MAX_BROKER_MESSAGE_BYTES) {
    throw new DOMException("Fenix broker RPC frame is too large.", "DataError");
  }
  return frame;
}

export function decodeFenixBrokerFrame(data: unknown): string | null {
  if (typeof data !== "string" || data.length > MAX_BROKER_ENVELOPE_CHARS) return null;
  try {
    const value = JSON.parse(data) as Partial<BrokerFrameEnvelope>;
    if (value.type !== BROKER_FRAME_TYPE || typeof value.payload !== "string") return null;
    if (new TextEncoder().encode(value.payload).byteLength > MAX_BROKER_MESSAGE_BYTES) return null;
    return value.payload;
  } catch {
    return null;
  }
}

/** Adapts the broker envelope to the websocket contract used by Effect RPC. */
export class FenixBrokerWebSocket extends EventTarget implements WebSocket {
  private readonly socket: WebSocket;
  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSING = 2 as const;
  readonly CLOSED = 3 as const;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;

  constructor(socket: WebSocket) {
    super();
    this.socket = socket;
    socket.addEventListener("open", (event) => this.forward("open", event));
    socket.addEventListener("error", (event) => this.forward("error", event));
    socket.addEventListener("close", (event) => this.forward("close", event));
    socket.addEventListener("message", (event) => {
      const payload = decodeFenixBrokerFrame(event.data);
      if (payload === null) return;
      const forwarded = new MessageEvent("message", {
        data: payload,
        origin: event.origin,
        lastEventId: event.lastEventId,
      });
      this.dispatchEvent(forwarded);
      this.onmessage?.(forwarded);
    });
  }

  private forward(type: "open" | "error" | "close", event: Event): void {
    this.dispatchEvent(event);
    if (type === "open") this.onopen?.(event);
    else if (type === "error") this.onerror?.(event);
    else this.onclose?.(event as CloseEvent);
  }

  get binaryType(): BinaryType {
    return this.socket.binaryType;
  }
  set binaryType(value: BinaryType) {
    this.socket.binaryType = value;
  }
  get bufferedAmount(): number {
    return this.socket.bufferedAmount;
  }
  get extensions(): string {
    return this.socket.extensions;
  }
  get protocol(): string {
    return this.socket.protocol;
  }
  get readyState(): WebSocket["readyState"] {
    return this.socket.readyState;
  }
  get url(): string {
    return this.socket.url;
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (data instanceof Blob) {
      throw new DOMException("Blob RPC frames are not supported.", "NotSupportedError");
    }
    this.socket.send(encodeFenixBrokerFrame(data));
  }
}
