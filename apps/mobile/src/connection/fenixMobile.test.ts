import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

vi.mock("expo-constants", () => ({
  default: {
    deviceName: "Test iPhone",
    expoConfig: { extra: { fenixPortal: { origin: "https://iaonline.io", agentId: 9 } } },
  },
}));

vi.mock("expo-crypto", async () => {
  const nodeCrypto = await import("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    getRandomBytes: (size: number) => new Uint8Array(nodeCrypto.randomBytes(size)),
    digest: async (_algorithm: string, input: Uint8Array) =>
      nodeCrypto.createHash("sha256").update(input).digest(),
  };
});

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

import {
  authorizeFenixMobileController,
  fenixMobileSocket,
  fenixMobileTargetRegistration,
  isFenixMobilePairingUrl,
  issueFenixMobileTargetTicket,
  listFenixMobileTargets,
  pairFenixMobileController,
  parseFenixMobilePairingUrl,
  type FenixMobileControllerRecord,
} from "./fenixMobile";

const ATTEMPT_ID = "a".repeat(32);
const PAIRING_TOKEN = "p".repeat(43);
const DEVICE_CREDENTIAL = "c".repeat(43);
const MOBILE_DEVICE_ID = "m".repeat(32);
const TARGET_DEVICE_ID = "r".repeat(32);
const TICKET = "t".repeat(43);
const pairingUrl = `fenixcode://mobile-pair?portal=${encodeURIComponent("https://iaonline.io")}&attemptId=${ATTEMPT_ID}&pairingToken=${PAIRING_TOKEN}`;

const controller: FenixMobileControllerRecord = {
  portalOrigin: "https://iaonline.io",
  deviceId: MOBILE_DEVICE_ID,
  deviceName: "Test iPhone",
  deviceCredential: DEVICE_CREDENTIAL,
  pairedAt: "2026-08-13T12:00:00Z",
};

describe("Fenix mobile controller", () => {
  it("accepts only the configured Fenix portal origin", () => {
    expect(isFenixMobilePairingUrl(pairingUrl)).toBe(true);
    expect(parseFenixMobilePairingUrl(pairingUrl)).toEqual({
      portalOrigin: "https://iaonline.io",
      attemptId: ATTEMPT_ID,
      pairingToken: PAIRING_TOKEN,
    });
    expect(() =>
      parseFenixMobilePairingUrl(
        `fenixcode://mobile-pair?portal=https%3A%2F%2Fevil.example&attemptId=${ATTEMPT_ID}&pairingToken=${PAIRING_TOKEN}`,
      ),
    ).toThrow("not bound to the configured Fenix portal");
  });

  it("consumes a one-time pairing as a mobile-only device and stores the credential securely", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItemAsync: async (key: string) => values.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => void values.set(key, value),
      deleteItemAsync: async (key: string) => void values.delete(key),
    };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        attemptId: ATTEMPT_ID,
        pairingToken: PAIRING_TOKEN,
        capabilities: ["mobile_controller"],
      });
      expect(String(body.publicKeyPem)).toContain("BEGIN PUBLIC KEY");
      expect(String(body.proofBase64).length).toBeGreaterThan(32);
      return new Response(
        JSON.stringify({
          device: {
            deviceId: MOBILE_DEVICE_ID,
            deviceName: "Test iPhone",
            pairedAt: "2026-08-13T12:00:00Z",
          },
          deviceCredential: DEVICE_CREDENTIAL,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(pairFenixMobileController({ pairingUrl, fetchImpl, storage })).resolves.toEqual(
      controller,
    );
    expect([...values.values()].join(" ")).toContain(DEVICE_CREDENTIAL);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("lists only valid owner-scoped targets", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          targets: [
            {
              deviceId: TARGET_DEVICE_ID,
              deviceName: "Mac de prueba",
              capabilities: ["local_runner", "rpc", "workspace.local"],
            },
            { deviceId: 1, deviceName: "invalid", capabilities: [] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(listFenixMobileTargets({ controller, fetchImpl })).resolves.toEqual([
      {
        deviceId: TARGET_DEVICE_ID,
        deviceName: "Mac de prueba",
        capabilities: ["local_runner", "rpc", "workspace.local"],
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(`https://iaonline.io/api/v1/code-lab/mobile/devices/${MOBILE_DEVICE_ID}/targets`),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ deviceCredential: DEVICE_CREDENTIAL }),
      }),
    );
  });

  it("keeps the app locked when no Fenix device credential exists", async () => {
    const storage = {
      getItemAsync: vi.fn(async () => null),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(authorizeFenixMobileController({ storage, fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("authorizes startup only after Fenix validates the stored device credential", async () => {
    const storage = {
      getItemAsync: vi.fn(async () => JSON.stringify(controller)),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ targets: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(authorizeFenixMobileController({ storage, fetchImpl })).resolves.toEqual({
      controller,
      targets: [],
    });
    expect(storage.deleteItemAsync).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    "revokes local app access after Fenix rejects the device with HTTP %s",
    async (status) => {
      const storage = {
        getItemAsync: vi.fn(async () => JSON.stringify(controller)),
        setItemAsync: vi.fn(async () => undefined),
        deleteItemAsync: vi.fn(async () => undefined),
      };
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status }));

      await expect(authorizeFenixMobileController({ storage, fetchImpl })).resolves.toBeNull();
      expect(storage.deleteItemAsync).toHaveBeenCalledTimes(1);
    },
  );

  it("uses a short-lived ticket for the selected local Companion", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ticket: TICKET,
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
          webSocketPath: "/code-lab/ws",
          protocol: "fenix-code-lab-v1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const prepared = await issueFenixMobileTargetTicket({
      deviceId: TARGET_DEVICE_ID,
      controller,
      fetchImpl,
    });

    expect(fenixMobileSocket(prepared)).toEqual({
      socketUrl: "wss://iaonline.io/code-lab/ws",
      protocols: ["fenix-code-lab-v1", `fenix-code-lab-ticket.${TICKET}`],
    });
    expect(
      fenixMobileTargetRegistration({
        deviceId: TARGET_DEVICE_ID,
        deviceName: "Mac de prueba",
        capabilities: ["local_runner", "rpc", "workspace.local"],
      }),
    ).toMatchObject({
      _tag: "FenixCompanionConnectionRegistration",
      target: {
        environmentId: `fenix-code-lab:${TARGET_DEVICE_ID}`,
        deviceId: TARGET_DEVICE_ID,
      },
    });
  });

  it("rejects an expired ticket before opening a socket", () => {
    expect(() =>
      fenixMobileSocket({
        portalOrigin: controller.portalOrigin,
        ticket: {
          ticket: TICKET,
          expiresAt: new Date(Date.now() - 1).toISOString(),
          webSocketPath: "/code-lab/ws",
          protocol: "fenix-code-lab-v1",
        },
      }),
    ).toThrow("ticket has expired");
  });
});
