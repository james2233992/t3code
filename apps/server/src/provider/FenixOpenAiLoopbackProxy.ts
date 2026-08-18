// @effect-diagnostics nodeBuiltinImport:off -- loopback-only HTTP boundary for the bundled runtime.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";

import { ProviderAdapterRequestError } from "./Errors.ts";
import type { FenixPairingSession, FenixPairingSessionResolver } from "./Layers/FenixAdapter.ts";

const PROVIDER = "fenix" as const;
const LOOPBACK_HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const UPSTREAM_URL = "https://iaonline.io/api/v1/code-lab/openai/v1/chat/completions";

export interface FenixOpenAiLoopbackProxy {
  readonly baseUrl: string;
  readonly apiKey: string;
}

function cleanBearer(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length);
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null;
}

function sameSecret(left: string | null, right: string): boolean {
  if (left === null) return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length && NodeCrypto.timingSafeEqual(leftBytes, rightBytes)
  );
}

function pairingHeaders(session: FenixPairingSession): Record<string, string> {
  return session.kind === "cookie"
    ? { cookie: `AuthToken=${session.authToken}` }
    : { authorization: `Bearer ${session.token}` };
}

function readBody(request: NodeHttp.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_REQUEST_BYTES) {
        settled = true;
        reject(new Error("request_too_large"));
        request.resume();
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on("error", (cause) => {
      if (settled) return;
      settled = true;
      reject(cause);
    });
  });
}

function writeJson(response: NodeHttp.ServerResponse, status: number, message: string): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ error: { message, type: "fenix_code_proxy_error" } }));
}

async function pipeWebResponse(
  upstream: Response,
  response: NodeHttp.ServerResponse,
): Promise<void> {
  response.statusCode = upstream.status;
  response.setHeader("cache-control", "no-store");
  response.setHeader(
    "content-type",
    upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
  );
  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!response.write(Buffer.from(next.value))) {
        await new Promise<void>((resolve) => response.once("drain", resolve));
      }
    }
    response.end();
  } finally {
    reader.releaseLock();
  }
}

export function makeFenixOpenAiLoopbackProxy(input: {
  readonly pairingSession: FenixPairingSessionResolver;
  readonly fetch?: typeof fetch;
}): Effect.Effect<FenixOpenAiLoopbackProxy, ProviderAdapterRequestError, Scope.Scope> {
  const apiKey = NodeCrypto.randomBytes(32).toString("base64url");
  const fetchImpl = input.fetch ?? fetch;

  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        new Promise<{ server: NodeHttp.Server; proxy: FenixOpenAiLoopbackProxy }>(
          (resolve, reject) => {
            const server = NodeHttp.createServer(async (request, response) => {
              if (
                request.method !== "POST" ||
                request.url !== "/v1/chat/completions" ||
                !sameSecret(cleanBearer(request.headers.authorization), apiKey)
              ) {
                writeJson(response, 404, "Fenix Code loopback route not found.");
                return;
              }

              try {
                const body = await readBody(request);
                const session = await Effect.runPromise(input.pairingSession());
                if (!session) {
                  writeJson(response, 503, "Fenix Code pairing is not active.");
                  return;
                }

                const abortController = new AbortController();
                response.once("close", () => {
                  if (!response.writableEnded) abortController.abort();
                });
                const upstream = await fetchImpl(UPSTREAM_URL, {
                  method: "POST",
                  headers: {
                    accept: "application/json, text/event-stream",
                    "content-type": "application/json",
                    ...pairingHeaders(session),
                  },
                  body,
                  signal: abortController.signal,
                });
                await pipeWebResponse(upstream, response);
              } catch (cause) {
                if (!response.headersSent) {
                  writeJson(
                    response,
                    cause instanceof Error && cause.message === "request_too_large" ? 413 : 502,
                    "Fenix Code could not relay the model request.",
                  );
                } else if (!response.writableEnded) {
                  response.destroy(cause instanceof Error ? cause : undefined);
                }
              }
            });
            server.maxConnections = 8;
            server.headersTimeout = 10_000;
            server.requestTimeout = 10 * 60_000;
            server.once("error", reject);
            server.listen(0, LOOPBACK_HOST, () => {
              const address = server.address();
              if (!address || typeof address === "string") {
                server.close();
                reject(new Error("invalid_loopback_address"));
                return;
              }
              server.removeListener("error", reject);
              resolve({
                server,
                proxy: {
                  baseUrl: `http://${LOOPBACK_HOST}:${address.port}/v1`,
                  apiKey,
                },
              });
            });
          },
        ),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "loopbackProxy.start",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
  ).pipe(Effect.map(({ proxy }) => proxy));
}
