import { describe, expect, it, vi } from "@effect/vitest";

import {
  buildFenixCompanionPairCommand,
  buildFenixCompanionInstallCommand,
  buildFenixMobilePairingUrl,
  classifyFenixPortalFailure,
  describeFenixPortalPairingFailure,
  fenixPortalDeviceRegistration,
  fenixPortalConnectedDeviceRegistrations,
  fenixPortalSocket,
  isFenixPortalEmbeddedApp,
  issueFenixPortalBrowserTicket,
  issueFenixPortalPairing,
  listFenixPortalDevices,
  readFenixPortalAgentId,
  revokeFenixPortalDevice,
  verifyFenixPortalSession,
} from "./fenixPortal.ts";

const PORTAL_URL = new URL("https://iaonline.io/code-lab/?agentId=9");
const TICKET = "t".repeat(43);

describe("Fenix portal companion API", () => {
  it("describes pairing failures without exposing arbitrary exception content", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    let httpFailure: unknown;
    try {
      await issueFenixPortalPairing({
        agentId: 9,
        deviceName: "Mac de prueba",
        fetchImpl,
        url: PORTAL_URL,
      });
    } catch (error) {
      httpFailure = error;
    }

    expect(describeFenixPortalPairingFailure(httpFailure)).toBe(
      "La API de Fenix ha respondido con HTTP 403.",
    );
    expect(describeFenixPortalPairingFailure(new Error("unexpected internal diagnostic"))).toBe(
      "Fenix ha devuelto una respuesta de emparejamiento no válida.",
    );
    expect(describeFenixPortalPairingFailure(new TypeError("Failed to fetch"))).toBe(
      "No se ha podido completar la conexión con Fenix.",
    );
  });

  it("builds a mobile QR bound to the authenticated portal pairing", () => {
    const url = new URL(
      buildFenixMobilePairingUrl({
        portalOrigin: "https://iaonline.io/code-lab/",
        pairing: {
          attemptId: "a".repeat(32),
          pairingToken: "p".repeat(43),
          expiresAt: "2026-08-13T12:05:00Z",
        },
      }),
    );

    expect(url.protocol).toBe("fenixcode:");
    expect(url.hostname).toBe("mobile-pair");
    expect(url.searchParams.get("portal")).toBe("https://iaonline.io");
    expect(url.searchParams.get("attemptId")).toBe("a".repeat(32));
    expect(url.searchParams.get("pairingToken")).toBe("p".repeat(43));
  });

  it("recognizes only the embedded Code Lab route and fails closed on an invalid agent", () => {
    expect(isFenixPortalEmbeddedApp(PORTAL_URL)).toBe(true);
    expect(readFenixPortalAgentId(PORTAL_URL)).toBe(9);
    expect(readFenixPortalAgentId(new URL("https://iaonline.io/code-lab/"))).toBe(9);
    expect(
      readFenixPortalAgentId(new URL("https://iaonline.io/code-lab/?agentId=invalid")),
    ).toBeNull();
    expect(isFenixPortalEmbeddedApp(new URL("https://iaonline.io/dashboard"))).toBe(false);
  });

  it("lists cookie-authenticated devices and maps them to platform registrations", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            devices: [
              {
                deviceId: "a".repeat(32),
                deviceName: "Juan Carlos Mac mini",
                capabilities: ["rpc"],
                revoked: false,
                connected: true,
              },
              {
                deviceId: "b".repeat(32),
                deviceName: "Offline Mac",
                capabilities: ["rpc"],
                revoked: false,
                connected: false,
              },
              {
                deviceId: 1,
                deviceName: "invalid",
                capabilities: [],
                revoked: false,
                connected: true,
              },
              {
                deviceId: "c".repeat(16),
                deviceName: "short identifier",
                capabilities: ["rpc"],
                revoked: false,
                connected: true,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const devices = await listFenixPortalDevices({ agentId: 9, fetchImpl, url: PORTAL_URL });

    expect(devices).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://iaonline.io/api/v1/code-lab/devices?agentId=9"),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fenixPortalDeviceRegistration(devices[0]!)).toMatchObject({
      _tag: "FenixCompanionConnectionRegistration",
      target: {
        _tag: "FenixCompanionConnectionTarget",
        environmentId: `fenix-code-lab:${"a".repeat(32)}`,
        deviceId: "a".repeat(32),
      },
    });
    expect(fenixPortalConnectedDeviceRegistrations(devices)).toHaveLength(1);
    expect(fenixPortalConnectedDeviceRegistrations(devices)[0]).toMatchObject({
      target: { deviceId: "a".repeat(32) },
    });
  });

  it("revokes only the authenticated owner's selected device with a fresh CSRF token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "csrf-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await revokeFenixPortalDevice({
      agentId: 9,
      deviceId: "a".repeat(32),
      fetchImpl,
      url: PORTAL_URL,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL(`https://iaonline.io/api/v1/code-lab/devices/${"a".repeat(32)}?agentId=9`),
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        headers: expect.objectContaining({ "X-CSRF-TOKEN": "csrf-token" }),
      }),
    );
  });

  it("fails closed before CSRF or network access for a malformed device identifier", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      revokeFenixPortalDevice({
        agentId: 9,
        deviceId: "../otro-equipo",
        fetchImpl,
        url: PORTAL_URL,
      }),
    ).rejects.toThrow("identificador local del equipo no es válido");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an authenticated Fenix owner envelope before rendering the embedded app", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: true,
          owner: { companyId: 1, userId: 100, agentId: 9 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      verifyFenixPortalSession({ agentId: 9, fetchImpl, url: PORTAL_URL }),
    ).resolves.toEqual({
      authenticated: true,
      owner: { companyId: 1, userId: 100, agentId: 9 },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://iaonline.io/api/v1/code-lab/session?agentId=9"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("fails closed when the Fenix session is absent or bound to another agent", async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "code_lab_unavailable" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      verifyFenixPortalSession({ agentId: 9, fetchImpl: denied, url: PORTAL_URL }),
    ).rejects.toThrow("HTTP 404");

    const wrongAgent = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: true,
          owner: { companyId: 1, userId: 100, agentId: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      verifyFenixPortalSession({ agentId: 9, fetchImpl: wrongAgent, url: PORTAL_URL }),
    ).rejects.toThrow("invalid authenticated session envelope");
  });

  it("uses a fresh CSRF token to issue a short-lived browser ticket", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ headerName: "X-CSRF-TOKEN", token: "csrf-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ticket: TICKET,
            expiresAt: "2026-08-12T20:00:00Z",
            webSocketPath: "/code-lab/ws",
            protocol: "fenix-code-lab-v1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const ticket = await issueFenixPortalBrowserTicket({
      agentId: 9,
      deviceId: "a".repeat(32),
      fetchImpl,
      url: PORTAL_URL,
    });

    expect(ticket.ticket).toBe(TICKET);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `https://iaonline.io/api/v1/code-lab/devices/${"a".repeat(32)}/ticket`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "X-CSRF-TOKEN": "csrf-token" }),
        body: JSON.stringify({ agentId: 9 }),
      }),
    );
    expect(fenixPortalSocket({ ticket, url: PORTAL_URL })).toEqual({
      socketUrl: "wss://iaonline.io/code-lab/ws",
      protocols: ["fenix-code-lab-v1", `fenix-code-lab-ticket.${TICKET}`],
    });
  });

  it("separates authentication rejection from retryable portal failures", async () => {
    const failureFromStatus = async (status: number) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "rejected" }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
      try {
        await issueFenixPortalBrowserTicket({
          agentId: 9,
          deviceId: "a".repeat(32),
          fetchImpl,
          url: PORTAL_URL,
        });
      } catch (error) {
        return classifyFenixPortalFailure(error);
      }
      throw new Error("Expected the portal request to fail.");
    };

    expect(await failureFromStatus(403)).toBe("authentication");
    expect(await failureFromStatus(503)).toBe("network");
    expect(classifyFenixPortalFailure(new DOMException("timeout", "TimeoutError"))).toBe("network");
  });

  it("issues a one-time local companion pairing and quotes the command safely", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { token: "csrf-token" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attemptId: "a".repeat(32),
            pairingToken: "p".repeat(43),
            expiresAt: "2026-08-12T20:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const pairing = await issueFenixPortalPairing({
      agentId: 9,
      deviceName: "Juan Carlos's Mac",
      fetchImpl,
      url: PORTAL_URL,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://iaonline.io/api/v1/code-lab/pairings",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "X-CSRF-TOKEN": "csrf-token" }),
        body: JSON.stringify({ agentId: 9, deviceName: "Juan Carlos's Mac" }),
      }),
    );
    const command = buildFenixCompanionPairCommand({
      portalOrigin: PORTAL_URL.origin,
      pairing,
    });
    expect(command).toBe(
      `fenix-code fenix pair --portal 'https://iaonline.io' --attempt-id '${"a".repeat(32)}' --pairing-token '${"p".repeat(43)}' --allow-root "$PWD"`,
    );
    expect(command).not.toMatch(/\bt3\b/i);

    const installCommand = buildFenixCompanionInstallCommand({
      artifactFileName: "Fenix-Code-Companion-0.0.32-macos-arm64.tar.gz",
      artifactSha256: "f".repeat(64),
      portalOrigin: PORTAL_URL.origin,
      pairing,
    });
    expect(installCommand).toBe(
      [
        "set -e",
        "printf 'Ruta absoluta de la carpeta local que autorizas: '",
        "IFS= read -r FENIX_CODE_ROOT",
        'case "$FENIX_CODE_ROOT" in /*) ;; *) echo "Debes indicar una ruta absoluta." >&2; exit 1 ;; esac',
        'test -d "$FENIX_CODE_ROOT" || { echo "La carpeta indicada no existe." >&2; exit 1; }',
        'FENIX_CODE_ARCHIVE="$HOME/Downloads/Fenix-Code-Companion-0.0.32-macos-arm64.tar.gz"',
        'if [ ! -f "$FENIX_CODE_ARCHIVE" ]; then',
        "  printf 'Ruta absoluta del paquete Fenix Code descargado: '",
        "  IFS= read -r FENIX_CODE_ARCHIVE",
        "fi",
        'case "$FENIX_CODE_ARCHIVE" in /*) ;; *) echo "Debes indicar una ruta absoluta al paquete." >&2; exit 1 ;; esac',
        'test -f "$FENIX_CODE_ARCHIVE" || { echo "No se encuentra el paquete descargado." >&2; exit 1; }',
        `test "$(shasum -a 256 "$FENIX_CODE_ARCHIVE" | awk '{print $1}')" = '${"f".repeat(64)}' || { echo "El paquete no supera la verificacion de integridad." >&2; exit 1; }`,
        'FENIX_CODE_INSTALL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fenix-code-install.XXXXXX")"',
        "trap 'rm -rf \"$FENIX_CODE_INSTALL_DIR\"' EXIT",
        'tar -xzf "$FENIX_CODE_ARCHIVE" -C "$FENIX_CODE_INSTALL_DIR"',
        "cd \"$FENIX_CODE_INSTALL_DIR\"/'Fenix-Code-Companion-0.0.32-macos-arm64'",
        `./install.sh --portal 'https://iaonline.io' --attempt-id '${"a".repeat(32)}' --pairing-token '${"p".repeat(43)}' --allow-root "$FENIX_CODE_ROOT"`,
      ].join("\n"),
    );
    expect(installCommand).not.toMatch(/\bt3\b/i);
  });

  it("keeps compatibility with a wrapped CSRF token envelope", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { token: "wrapped-csrf-token" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attemptId: "a".repeat(32),
            pairingToken: "p".repeat(43),
            expiresAt: "2026-08-12T20:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    await issueFenixPortalPairing({
      agentId: 9,
      deviceName: "Mac de prueba",
      fetchImpl,
      url: PORTAL_URL,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://iaonline.io/api/v1/code-lab/pairings",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-CSRF-TOKEN": "wrapped-csrf-token" }),
      }),
    );
  });

  it("uses a wrapped CSRF token when a direct token field is malformed", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: { malformed: true },
            data: { token: "wrapped-csrf-token" },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attemptId: "a".repeat(32),
            pairingToken: "p".repeat(43),
            expiresAt: "2026-08-12T20:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    await issueFenixPortalPairing({
      agentId: 9,
      deviceName: "Mac de prueba",
      fetchImpl,
      url: PORTAL_URL,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://iaonline.io/api/v1/code-lab/pairings",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-CSRF-TOKEN": "wrapped-csrf-token" }),
      }),
    );
  });

  it("rejects an unsafe package name in the login-bound install command", () => {
    expect(() =>
      buildFenixCompanionInstallCommand({
        artifactFileName: "../companion.tar.gz",
        artifactSha256: "f".repeat(64),
        portalOrigin: PORTAL_URL.origin,
        pairing: {
          attemptId: "a".repeat(32),
          pairingToken: "p".repeat(43),
          expiresAt: "2026-08-12T20:00:00Z",
        },
      }),
    ).toThrow("invalid companion archive name");
  });

  it("rejects an unsafe package checksum in the login-bound install command", () => {
    expect(() =>
      buildFenixCompanionInstallCommand({
        artifactFileName: "Fenix-Code-Companion-0.0.32-macos-arm64.tar.gz",
        artifactSha256: "not-a-checksum",
        portalOrigin: PORTAL_URL.origin,
        pairing: {
          attemptId: "a".repeat(32),
          pairingToken: "p".repeat(43),
          expiresAt: "2026-08-12T20:00:00Z",
        },
      }),
    ).toThrow("invalid companion archive checksum");
  });
});
