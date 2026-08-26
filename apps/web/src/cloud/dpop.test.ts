import { verifyDpopProof } from "@t3tools/shared/dpop";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decodeJwt } from "jose";
import { vi } from "vite-plus/test";

import {
  browserCryptoLayer,
  createBrowserDpopProof,
  generateBrowserDpopKey,
  readStoredBrowserDpopKey,
  writeStoredBrowserDpopKey,
} from "./dpop";

describe("browser DPoP proofs", () => {
  it.effect("signs relay resource proofs with an access-token hash", () =>
    Effect.gen(function* () {
      vi.stubGlobal("indexedDB", undefined);
      const proofKey = yield* generateBrowserDpopKey;
      const proof = yield* createBrowserDpopProof({
        method: "POST",
        url: "https://relay.example.test/v1/environments/env-1/connect?ignored=true",
        accessToken: "relay-access-token",
        proofKey,
      }).pipe(Effect.provide(browserCryptoLayer));
      const issuedAt = decodeJwt(proof.proof).iat;
      expect(issuedAt).toBeTypeOf("number");

      expect(
        verifyDpopProof({
          proof: proof.proof,
          method: "POST",
          url: "https://relay.example.test/v1/environments/env-1/connect",
          expectedThumbprint: proof.thumbprint,
          expectedAccessToken: "relay-access-token",
          nowEpochSeconds: issuedAt!,
        }),
      ).toMatchObject({ ok: true });
    }),
  );

  it.effect("uses an ephemeral DPoP key when an opaque sandbox denies indexedDB", () =>
    Effect.gen(function* () {
      const deniedGlobal = globalThis as typeof globalThis & { indexedDB?: IDBFactory };
      const original = Object.getOwnPropertyDescriptor(deniedGlobal, "indexedDB");
      Object.defineProperty(deniedGlobal, "indexedDB", {
        configurable: true,
        get() {
          throw new DOMException("Blocked by opaque origin", "SecurityError");
        },
      });

      try {
        const key = yield* generateBrowserDpopKey;
        expect(yield* readStoredBrowserDpopKey()).toBeNull();
        yield* writeStoredBrowserDpopKey(key);
      } finally {
        if (original) Object.defineProperty(deniedGlobal, "indexedDB", original);
        else delete deniedGlobal.indexedDB;
      }
    }).pipe(Effect.provide(browserCryptoLayer)),
  );
});
