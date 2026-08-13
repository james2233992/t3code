import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import { writeFenixCompanionConfig } from "../../fenix/CompanionConfig.ts";
import * as FenixPairingSessionBridge from "./FenixPairingSessionBridge.ts";

const DEVICE_ID = "device-fenix-0001";
const DEVICE_CREDENTIAL = "device-credential-0000000000000001";
const FUTURE_EXPIRES_AT = "2100-01-01T00:00:00.000Z";

const envelope = (overrides: Record<string, unknown> = {}) => ({
  kind: "bearer",
  accessToken: "fenix.access-token_1",
  expiresAt: FUTURE_EXPIRES_AT,
  audience: "https://iaonline.io",
  scopes: ["fenix.chatmodels.generic"],
  owner: {
    companyId: 5,
    userId: 10,
    agentId: 295,
  },
  device: {
    deviceId: DEVICE_ID,
    tunnelId: "tunnel-1",
    fingerprint: "fingerprint-1",
  },
  ...overrides,
});

const resolveSnapshot = (
  overrides: Partial<FenixPairingSessionBridge.FenixCompanionBridgeHttpConfig> = {},
) => {
  const requests: Array<{ readonly url: string; readonly body: unknown }> = [];
  const fetchMock = (async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as unknown,
    });
    return Response.json(envelope());
  }) as unknown as typeof fetch;

  const effect = FenixPairingSessionBridge.resolvePairingSessionSnapshotFromHttp({
    baseUrl: "http://127.0.0.1:5100",
    deviceId: DEVICE_ID,
    deviceCredential: DEVICE_CREDENTIAL,
    fetch: fetchMock,
    nowEpochMs: () => 1,
    ...overrides,
  });
  return { effect, requests };
};

describe("FenixPairingSessionBridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.effect("issues an active bearer snapshot from the local companion endpoint", () =>
    Effect.gen(function* () {
      const { effect, requests } = resolveSnapshot();

      const snapshot = yield* effect;

      expect(snapshot).toEqual({
        session: { kind: "bearer", token: "fenix.access-token_1" },
        expiresAtEpochMs: Date.parse(FUTURE_EXPIRES_AT),
        tenantScope: { companyId: 5, userId: 10 },
      });
      expect(requests).toEqual([
        {
          url: `http://127.0.0.1:5100/api/v1/code-lab/companion/devices/${DEVICE_ID}/fenix-credential`,
          body: {
            deviceCredential: DEVICE_CREDENTIAL,
            audience: "https://iaonline.io",
          },
        },
      ]);
    }),
  );

  it.effect("reads the device credential from a regular 0600 file only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenix-bridge-" });
      const lexicalCredentialFile = path.join(tempDir, "device-credential");
      yield* fs.writeFileString(lexicalCredentialFile, `${DEVICE_CREDENTIAL}\n`);
      yield* fs.chmod(lexicalCredentialFile, 0o600);
      const credentialFile = yield* fs.realPath(lexicalCredentialFile);
      const clean = resolveSnapshot({
        deviceCredential: undefined,
        deviceCredentialFile: credentialFile,
      });
      const snapshot = yield* clean.effect;

      yield* fs.chmod(credentialFile, 0o644);
      const loose = resolveSnapshot({
        deviceCredential: undefined,
        deviceCredentialFile: credentialFile,
      });
      const rejected = yield* loose.effect;

      expect(snapshot?.session).toEqual({ kind: "bearer", token: "fenix.access-token_1" });
      expect(rejected).toBeNull();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails closed for non-loopback companion urls before fetch", () =>
    Effect.gen(function* () {
      const fetchMock = (async () => {
        throw new Error("fetch must not be called");
      }) as unknown as typeof fetch;

      const snapshot = yield* FenixPairingSessionBridge.resolvePairingSessionSnapshotFromHttp({
        baseUrl: "https://iaonline.io",
        deviceId: DEVICE_ID,
        deviceCredential: DEVICE_CREDENTIAL,
        fetch: fetchMock,
      });

      expect(snapshot).toBeNull();
    }),
  );

  it.effect("uses an exact trusted portal origin for a paired production companion", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const fetchMock = (async (url: Parameters<typeof fetch>[0]) => {
        requests.push(String(url));
        return Response.json(envelope());
      }) as unknown as typeof fetch;

      const trusted =
        yield* FenixPairingSessionBridge.resolvePairingSessionSnapshotFromTrustedPortal({
          baseUrl: "https://iaonline.io",
          deviceId: DEVICE_ID,
          deviceCredential: DEVICE_CREDENTIAL,
          fetch: fetchMock,
          nowEpochMs: () => 1,
        });
      const foreign =
        yield* FenixPairingSessionBridge.resolvePairingSessionSnapshotFromTrustedPortal({
          baseUrl: "https://evil.example",
          deviceId: DEVICE_ID,
          deviceCredential: DEVICE_CREDENTIAL,
          fetch: fetchMock,
          nowEpochMs: () => 1,
        });

      expect(trusted?.session).toEqual({ kind: "bearer", token: "fenix.access-token_1" });
      expect(foreign).toBeNull();
      expect(requests).toEqual([
        `https://iaonline.io/api/v1/code-lab/companion/devices/${DEVICE_ID}/fenix-credential`,
      ]);
    }),
  );

  it.effect("fails closed for expired, malformed, revoked, and rate-limited envelopes", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly name: string;
        readonly response: Response;
      }> = [
        {
          name: "expired",
          response: Response.json(envelope({ expiresAt: "1970-01-01T00:00:03.000Z" })),
        },
        {
          name: "wrong audience",
          response: Response.json(envelope({ audience: "https://evil.example" })),
        },
        {
          name: "missing scope",
          response: Response.json(envelope({ scopes: ["fenix.other"] })),
        },
        {
          name: "malformed token",
          response: Response.json(envelope({ accessToken: "fenix-token\r\nx-leak: true" })),
        },
        {
          name: "owner mismatch revoked device",
          response: Response.json({ error: "code_lab_device_unavailable" }, { status: 404 }),
        },
        {
          name: "rate limited",
          response: Response.json({ error: "rate_limited" }, { status: 429 }),
        },
      ];

      for (const testCase of cases) {
        const snapshot = yield* FenixPairingSessionBridge.resolvePairingSessionSnapshotFromHttp({
          baseUrl: "http://localhost:5100",
          deviceId: DEVICE_ID,
          deviceCredential: DEVICE_CREDENTIAL,
          fetch: (async () => testCase.response) as unknown as typeof fetch,
          nowEpochMs: () => 1,
        });
        expect(snapshot, testCase.name).toBeNull();
      }
    }),
  );

  it.effect("resolves the paired companion config through the trusted portal", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenix-live-bridge-" });
      vi.stubEnv("FENIX_CODE_COMPANION_BASE_URL", "");
      vi.stubEnv("FENIX_CODE_COMPANION_DEVICE_ID", "");
      vi.stubEnv("FENIX_CODE_COMPANION_DEVICE_CREDENTIAL_FILE", "");
      vi.stubGlobal("fetch", (async () => Response.json(envelope())) as unknown as typeof fetch);
      yield* Effect.promise(() =>
        writeFenixCompanionConfig(stateDir, {
          version: 1,
          portalOrigin: "https://iaonline.io",
          deviceId: DEVICE_ID,
          deviceName: "Fenix test companion",
          deviceCredential: DEVICE_CREDENTIAL,
          allowedRoots: [stateDir],
        }),
      );
      const serverConfigLayer = ServerConfig.layer({
        stateDir,
      } as ServerConfig.ServerConfig["Service"]);
      const snapshot = yield* Effect.gen(function* () {
        const bridge = yield* FenixPairingSessionBridge.FenixPairingSessionBridge;
        return yield* bridge.resolvePairingSessionSnapshot({
          instanceId: ProviderInstanceId.make("fenix"),
        });
      }).pipe(
        Effect.provide(FenixPairingSessionBridge.liveLayer.pipe(Layer.provide(serverConfigLayer))),
      );

      expect(snapshot?.tenantScope).toEqual({ companyId: 5, userId: 10 });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
