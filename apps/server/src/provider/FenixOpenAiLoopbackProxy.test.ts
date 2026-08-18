// @effect-diagnostics nodeBuiltinImport:off
import * as NodeHttp from "node:http";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeFenixOpenAiLoopbackProxy } from "./FenixOpenAiLoopbackProxy.ts";

function post(baseUrl: string, apiKey: string, body: string) {
  return Effect.tryPromise(
    () =>
      new Promise<{ readonly status: number }>((resolve, reject) => {
        const request = NodeHttp.request(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve({ status: response.statusCode ?? 0 }));
          },
        );
        request.once("error", reject);
        request.end(body);
      }),
  );
}

describe("FenixOpenAiLoopbackProxy", () => {
  it.effect("binds locally, resolves fresh pairing and forwards no local proxy secret", () =>
    Effect.gen(function* () {
      const upstream: Array<{
        url: string;
        authorization: string | null;
        cookie: string | null;
        body: string;
      }> = [];
      let pairingCalls = 0;
      const fetchImpl = (async (url, init) => {
        const headers = new Headers(init?.headers);
        upstream.push({
          url: String(url),
          authorization: headers.get("authorization"),
          cookie: headers.get("cookie"),
          body: String(init?.body),
        });
        return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] });
      }) as typeof fetch;
      const proxy = yield* makeFenixOpenAiLoopbackProxy({
        fetch: fetchImpl,
        pairingSession: () => {
          pairingCalls += 1;
          return Effect.succeed({ kind: "cookie" as const, authToken: "paired-session" });
        },
      });

      expect(proxy.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const body = JSON.stringify({ model: "fenix/openai/gpt-oss-120b", messages: [] });
      expect((yield* post(proxy.baseUrl, proxy.apiKey, body)).status).toBe(200);
      expect((yield* post(proxy.baseUrl, proxy.apiKey, body)).status).toBe(200);

      expect(pairingCalls).toBe(2);
      expect(upstream).toHaveLength(2);
      expect(upstream[0]).toEqual({
        url: "https://iaonline.io/api/v1/code-lab/openai/v1/chat/completions",
        authorization: null,
        cookie: "AuthToken=paired-session",
        body,
      });
      expect(upstream[0]?.body).not.toContain(proxy.apiKey);
    }).pipe(Effect.scoped),
  );

  it.effect("does not call Fenix for an invalid local secret or inactive pairing", () =>
    Effect.gen(function* () {
      let upstreamCalls = 0;
      const proxy = yield* makeFenixOpenAiLoopbackProxy({
        fetch: (async () => {
          upstreamCalls += 1;
          return Response.json({});
        }) as unknown as typeof fetch,
        pairingSession: () => Effect.succeed(null),
      });
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const body = JSON.stringify({ model: "fenix/openai/gpt-oss-120b", messages: [] });

      expect((yield* post(proxy.baseUrl, "A".repeat(43), body)).status).toBe(404);
      expect((yield* post(proxy.baseUrl, proxy.apiKey, body)).status).toBe(503);
      expect(upstreamCalls).toBe(0);
    }).pipe(Effect.scoped),
  );
});
