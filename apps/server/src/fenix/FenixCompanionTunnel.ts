import { AuthStandardClientScopes } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServer,
} from "effect/unstable/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { isValidFenixCodeTenantScope } from "./FenixCodeTenantScope.ts";
import { readFenixCompanionConfig, type FenixCompanionConfig } from "./CompanionConfig.ts";

const CODE_LAB_PROTOCOL = "fenix-code-lab-v1";
const CODE_LAB_TICKET_PREFIX = "fenix-code-lab-ticket.";
const CODE_LAB_WEBSOCKET_PATH = "/code-lab/ws";
const MAX_BROKER_MESSAGE_BYTES = 128 * 1024;
const MAX_BROKER_ENVELOPE_CHARS = MAX_BROKER_MESSAGE_BYTES * 6 + 256;
const SESSION_ROTATION_MS = 4 * 60 * 1_000;

const RuntimeTicketEnvelope = Schema.Struct({
  ticket: Schema.String,
  expiresAt: Schema.String,
  webSocketPath: Schema.String,
  protocol: Schema.String,
  owner: Schema.Struct({
    companyId: Schema.Number,
    userId: Schema.Number,
    agentId: Schema.Number,
  }),
});
type RuntimeTicketEnvelope = typeof RuntimeTicketEnvelope.Type;

class FenixCompanionTunnelError extends Data.TaggedError("FenixCompanionTunnelError")<{
  readonly message: string;
}> {}

function socketText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return null;
}

export function decodeFenixCompanionBrokerPayload(data: unknown): string | null {
  const text = socketText(data);
  if (text === null || text.length > MAX_BROKER_ENVELOPE_CHARS) {
    return null;
  }
  try {
    const envelope = JSON.parse(text) as { readonly type?: unknown; readonly payload?: unknown };
    if (envelope.type !== "rpc.frame" || typeof envelope.payload !== "string") return null;
    return new TextEncoder().encode(envelope.payload).byteLength <= MAX_BROKER_MESSAGE_BYTES
      ? envelope.payload
      : null;
  } catch {
    return null;
  }
}

export function encodeFenixCompanionBrokerFrame(data: unknown): string | null {
  const payload = socketText(data);
  if (payload === null) return null;
  const frame = JSON.stringify({ type: "rpc.frame", payload });
  return new TextEncoder().encode(frame).byteLength <= MAX_BROKER_MESSAGE_BYTES ? frame : null;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const opened = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Fenix companion websocket failed before opening."));
    };
    const cleanup = () => {
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", failed);
      socket.removeEventListener("close", failed);
    };
    socket.addEventListener("open", opened, { once: true });
    socket.addEventListener("error", failed, { once: true });
    socket.addEventListener("close", failed, { once: true });
  });
}

function closeSocket(socket: WebSocket): void {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close(1000, "Fenix companion session rotation");
  }
}

function bridgeSockets(local: WebSocket, remote: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      closeSocket(local);
      closeSocket(remote);
      if (error === undefined) resolve();
      else reject(error);
    };
    local.addEventListener("message", (event) => {
      const frame = encodeFenixCompanionBrokerFrame(event.data);
      if (frame !== null && remote.readyState === WebSocket.OPEN) remote.send(frame);
    });
    remote.addEventListener("message", (event) => {
      const payload = decodeFenixCompanionBrokerPayload(event.data);
      if (payload !== null && local.readyState === WebSocket.OPEN) local.send(payload);
    });
    local.addEventListener("close", () => finish(), { once: true });
    remote.addEventListener("close", () => finish(), { once: true });
    local.addEventListener("error", () => finish(new Error("Local Fenix Code socket failed.")), {
      once: true,
    });
    remote.addEventListener("error", () => finish(new Error("Fenix broker socket failed.")), {
      once: true,
    });
  });
}

const requestRuntimeTicket = Effect.fn("fenix.companion.requestRuntimeTicket")(function* (
  config: FenixCompanionConfig,
): Effect.fn.Return<RuntimeTicketEnvelope, FenixCompanionTunnelError, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  const value = yield* HttpClientRequest.post(
    new URL(
      `/api/v1/code-lab/companion/devices/${encodeURIComponent(config.deviceId)}/ticket`,
      config.portalOrigin,
    ).toString(),
  ).pipe(
    HttpClientRequest.setHeader("accept", "application/json"),
    HttpClientRequest.bodyJson({ deviceCredential: config.deviceCredential }),
    Effect.flatMap(client.execute),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeTicketEnvelope)),
    Effect.mapError(
      () =>
        new FenixCompanionTunnelError({
          message: "Fenix companion ticket request failed.",
        }),
    ),
  );
  const expiresAt = Date.parse(value.expiresAt);
  const now = yield* Clock.currentTimeMillis;
  if (
    value.protocol !== CODE_LAB_PROTOCOL ||
    value.webSocketPath !== CODE_LAB_WEBSOCKET_PATH ||
    typeof value.ticket !== "string" ||
    value.ticket.length !== 43 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now + 5_000 ||
    !isValidFenixCodeTenantScope(value.owner) ||
    !Number.isSafeInteger(value.owner.agentId) ||
    value.owner.agentId <= 0
  ) {
    return yield* new FenixCompanionTunnelError({
      message: "Fenix companion ticket envelope is invalid or expired.",
    });
  }
  return value;
});

function localSocketUrl(server: HttpServer.HttpServer["Service"], ticket: string): string {
  const address = server.address;
  if (typeof address === "string" || !("port" in address)) {
    throw new Error("Fenix companion requires a TCP loopback server address.");
  }
  const url = new URL(`ws://127.0.0.1:${address.port}/ws`);
  url.searchParams.set("wsTicket", ticket);
  return url.toString();
}

function remoteSocket(config: FenixCompanionConfig, ticket: RuntimeTicketEnvelope): WebSocket {
  const url = new URL(ticket.webSocketPath, config.portalOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url, [CODE_LAB_PROTOCOL, `${CODE_LAB_TICKET_PREFIX}${ticket.ticket}`]);
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;
    const companion = yield* Effect.tryPromise(() =>
      readFenixCompanionConfig(serverConfig.stateDir),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Fenix companion configuration was rejected", { cause }).pipe(
          Effect.as(null),
        ),
      ),
    );
    if (companion === null) return;

    const server = yield* HttpServer.HttpServer;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const connectOnce = Effect.acquireUseRelease(
      Effect.gen(function* () {
        const runtimeTicket = yield* requestRuntimeTicket(companion);
        const session = yield* auth.issueSession({
          ttl: Duration.minutes(5),
          subject: `fenix-code-lab:${companion.deviceId}`,
          label: companion.deviceName,
          scopes: AuthStandardClientScopes,
          fenixCodeTenantScope: {
            companyId: runtimeTicket.owner.companyId,
            userId: runtimeTicket.owner.userId,
          },
        });
        const websocketTicket = yield* auth.issueWebSocketTicket({
          sessionId: session.sessionId,
          fenixCodeTenantScope: {
            companyId: runtimeTicket.owner.companyId,
            userId: runtimeTicket.owner.userId,
          },
        });
        const sockets = yield* Effect.try({
          try: () => ({
            local: new WebSocket(localSocketUrl(server, websocketTicket.ticket)),
            remote: remoteSocket(companion, runtimeTicket),
          }),
          catch: () =>
            new FenixCompanionTunnelError({
              message: "Fenix companion sockets could not be created.",
            }),
        });
        return { session, ...sockets };
      }),
      ({ local, remote }) =>
        Effect.tryPromise({
          try: async () => {
            await Promise.all([waitForOpen(local), waitForOpen(remote)]);
            await bridgeSockets(local, remote);
          },
          catch: () =>
            new FenixCompanionTunnelError({
              message: "Fenix companion websocket bridge disconnected.",
            }),
        }).pipe(Effect.raceFirst(Effect.sleep(Duration.millis(SESSION_ROTATION_MS)))),
      ({ session, local, remote }) =>
        Effect.sync(() => {
          closeSocket(local);
          closeSocket(remote);
        }).pipe(
          Effect.andThen(auth.revokeSession(session.sessionId)),
          Effect.ignore({ log: true }),
        ),
    ).pipe(
      Effect.tap(() => Effect.logInfo("Fenix companion session rotated")),
      Effect.tapError((cause) =>
        Effect.logWarning("Fenix companion tunnel disconnected", { cause }),
      ),
    );

    yield* connectOnce.pipe(
      Effect.retry(
        Schedule.exponential("1 second").pipe(
          Schedule.modifyDelay(({ duration }) =>
            Effect.succeed(Duration.min(duration, Duration.seconds(30))),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
