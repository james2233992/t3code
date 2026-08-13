import { AuthStandardClientScopes } from "@t3tools/contracts";
// @effect-diagnostics-next-line nodeBuiltinImport:off - packaged-runtime marker verification precedes Effect services.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off - packaged-runtime marker is resolved from the immutable entry path.
import * as NodePath from "node:path";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { HttpServer } from "effect/unstable/http";

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
const RUNTIME_TICKET_TIMEOUT_MS = 10_000;
const PACKAGED_AUTH_MARKER = ".fenix-portal-auth-required";
let packagedRuntimeCache: boolean | undefined;

export function keepFenixCompanionSessionsAlive<A, E, R>(
  connectOnce: Effect.Effect<A, E, R>,
): Effect.Effect<never, E, R> {
  return connectOnce.pipe(
    Effect.retry(
      Schedule.exponential("1 second").pipe(
        Schedule.modifyDelay(({ duration }) =>
          Effect.succeed(Duration.min(duration, Duration.seconds(30))),
        ),
      ),
    ),
    Effect.andThen(Effect.sleep("1 second")),
    Effect.forever,
  );
}

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
const decodeRuntimeTicketEnvelope = Schema.decodeUnknownPromise(RuntimeTicketEnvelope);

export class FenixCompanionTunnelError extends Data.TaggedError("FenixCompanionTunnelError")<{
  readonly message: string;
  readonly kind: "authorization" | "configuration" | "transient";
}> {}

class RuntimeTicketRequestError extends Error {
  readonly kind: FenixCompanionTunnelError["kind"];

  constructor(message: string, kind: FenixCompanionTunnelError["kind"]) {
    super(message);
    this.kind = kind;
  }
}

export interface FenixCompanionStartupAuthorization {
  readonly companion: FenixCompanionConfig;
}

export function isFenixPortalAuthorizationRequired(
  value = process.env.FENIX_CODE_REQUIRE_PORTAL_AUTH,
  packagedRuntime = isPackagedFenixCompanionRuntime(),
): boolean {
  return value === "1" || packagedRuntime;
}

export function isPackagedFenixCompanionRuntime(entryPath = process.argv[1]): boolean {
  if (typeof entryPath !== "string" || entryPath.length === 0) return false;
  const useCache = entryPath === process.argv[1];
  if (useCache && packagedRuntimeCache !== undefined) return packagedRuntimeCache;
  const runtimeRoot = NodePath.resolve(NodePath.dirname(entryPath), "../../..");
  const pathLooksPackaged =
    entryPath.includes(`${NodePath.sep}runtime${NodePath.sep}versions${NodePath.sep}`) &&
    entryPath.endsWith(
      `${NodePath.sep}node_modules${NodePath.sep}t3${NodePath.sep}dist${NodePath.sep}bin.mjs`,
    );
  try {
    const packaged = pathEntryExists(NodePath.join(runtimeRoot, PACKAGED_AUTH_MARKER));
    if (useCache) packagedRuntimeCache = packaged;
    return packaged;
  } catch {
    // The runtime may be readable while a parent directory probe is temporarily denied.
    // An installed-path match must fail closed, and the failed probe must not be cached.
    return pathLooksPackaged;
  }
}

function pathEntryExists(path: string): boolean {
  try {
    NodeFS.lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

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

export function keepFenixCompanionSessionsAuthorized<A, E, R, R2>(
  connectOnce: Effect.Effect<A, E, R>,
  onAuthorizationLoss: (error: E) => Effect.Effect<void, never, R2>,
): Effect.Effect<never, never, R | R2> {
  return connectOnce.pipe(
    Effect.andThen(Effect.sleep("1 second")),
    Effect.forever,
    Effect.catch((error) => onAuthorizationLoss(error).pipe(Effect.andThen(Effect.never))),
  );
}

export function keepRequiredFenixCompanionSessionsAuthorized<A, R, R2>(
  connectOnce: Effect.Effect<A, FenixCompanionTunnelError, R>,
  onAuthorizationLoss: (error: FenixCompanionTunnelError) => Effect.Effect<void, never, R2>,
): Effect.Effect<never, never, R | R2> {
  const connectWithTransientRetry = connectOnce.pipe(
    Effect.retry({
      while: (error) => error.kind === "transient",
      times: 3,
      schedule: Schedule.exponential("2 seconds").pipe(
        Schedule.modifyDelay(({ duration }) =>
          Effect.succeed(Duration.min(duration, Duration.seconds(8))),
        ),
      ),
    }),
  );
  return keepFenixCompanionSessionsAuthorized(connectWithTransientRetry, onAuthorizationLoss);
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

export async function fetchFenixCompanionRuntimeTicket(
  config: FenixCompanionConfig,
  options?: {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  },
): Promise<RuntimeTicketEnvelope> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? RUNTIME_TICKET_TIMEOUT_MS;
  const controller = new AbortController();
  // @effect-diagnostics-next-line globalTimers:off - one deadline covers native fetch and body decoding before Effect services exist.
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      new URL(
        `/api/v1/code-lab/companion/devices/${encodeURIComponent(config.deviceId)}/ticket`,
        config.portalOrigin,
      ),
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCredential: config.deviceCredential }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const kind = [401, 403, 404].includes(response.status) ? "authorization" : "transient";
      throw new RuntimeTicketRequestError(
        `Fenix companion ticket request failed (HTTP ${response.status}).`,
        kind,
      );
    }
    return await decodeRuntimeTicketEnvelope(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

const requestRuntimeTicket = Effect.fn("fenix.companion.requestRuntimeTicket")(function* (
  config: FenixCompanionConfig,
): Effect.fn.Return<RuntimeTicketEnvelope, FenixCompanionTunnelError> {
  const value = yield* Effect.tryPromise({
    try: () => fetchFenixCompanionRuntimeTicket(config),
    catch: (error) =>
      new FenixCompanionTunnelError({
        message: "Fenix companion ticket request failed.",
        kind: error instanceof RuntimeTicketRequestError ? error.kind : "transient",
      }),
  });
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
      kind: "authorization",
    });
  }
  return value;
});

export const requireFenixCompanionStartupAuthorization = Effect.fn(
  "fenix.companion.requireStartupAuthorization",
)(function* (
  stateDir: string,
  required = isFenixPortalAuthorizationRequired(),
): Effect.fn.Return<FenixCompanionStartupAuthorization | null, FenixCompanionTunnelError> {
  if (!required) return null;
  const companion = yield* Effect.tryPromise(() => readFenixCompanionConfig(stateDir)).pipe(
    Effect.mapError(
      () =>
        new FenixCompanionTunnelError({
          message: "Fenix companion configuration was rejected.",
          kind: "configuration",
        }),
    ),
  );
  if (companion === null) {
    return yield* new FenixCompanionTunnelError({
      message:
        "Fenix authorization is required. Sign in at iaonline.io and generate a new installation command.",
      kind: "authorization",
    });
  }
  yield* requestRuntimeTicket(companion);
  return { companion };
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

export function layerWithOptions(options?: {
  readonly initialAuthorization?: FenixCompanionStartupAuthorization | undefined;
  readonly required?: boolean | undefined;
  readonly onAuthorizationLoss?:
    | ((error: FenixCompanionTunnelError) => Effect.Effect<void>)
    | undefined;
}) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const required = options?.required ?? false;
      const initialAuthorization = options?.initialAuthorization;
      const companion =
        initialAuthorization?.companion ??
        (yield* Effect.tryPromise(() => readFenixCompanionConfig(serverConfig.stateDir)).pipe(
          required
            ? Effect.mapError(
                () =>
                  new FenixCompanionTunnelError({
                    message: "Fenix companion configuration was rejected.",
                    kind: "configuration",
                  }),
              )
            : Effect.catch((cause) =>
                Effect.logWarning("Fenix companion configuration was rejected", { cause }).pipe(
                  Effect.as(null),
                ),
              ),
        ));
      if (companion === null) {
        if (required) {
          return yield* new FenixCompanionTunnelError({
            message: "Fenix authorization is required before the server can start.",
            kind: "authorization",
          });
        }
        return;
      }

      const server = yield* HttpServer.HttpServer;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const connectOnce = Effect.acquireUseRelease(
        Effect.gen(function* () {
          // The preflight ticket proves access before the server listens. Request a fresh
          // short-lived ticket here so a slow startup cannot reuse an almost-expired ticket.
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
                kind: "transient",
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
                kind: "transient",
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

      const requiredConnectOnce = connectOnce.pipe(
        Effect.mapError((error) =>
          error instanceof FenixCompanionTunnelError
            ? error
            : new FenixCompanionTunnelError({
                message: "Fenix companion session failed.",
                kind: "transient",
              }),
        ),
      );
      const maintainSessions = required
        ? keepRequiredFenixCompanionSessionsAuthorized(
            requiredConnectOnce,
            options?.onAuthorizationLoss ??
              ((cause) =>
                Effect.logError(
                  cause.kind === "authorization"
                    ? "Fenix authorization was rejected; stopping the local server"
                    : "The required Fenix authorization channel failed; stopping the local server",
                  { cause },
                ).pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      process.kill(process.pid, "SIGTERM");
                    }),
                  ),
                )),
          )
        : keepFenixCompanionSessionsAlive(connectOnce);
      yield* maintainSessions.pipe(Effect.forkScoped);
    }),
  );
}

export const layer = layerWithOptions();
