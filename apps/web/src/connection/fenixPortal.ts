import {
  FenixCompanionConnectionRegistration,
  FenixCompanionConnectionTarget,
  type PlatformConnectionRegistration,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";

const CODE_LAB_PATH_PREFIX = "/code-lab/";
const CODE_LAB_API_BASE = "/api/v1/code-lab";
const CODE_LAB_PROTOCOL = "fenix-code-lab-v1";
const CODE_LAB_TICKET_PREFIX = "fenix-code-lab-ticket.";
const CODE_LAB_BRIDGE_CHANNEL = "fenix-code-lab-bridge-v1";
const CODE_LAB_BRIDGE_TOKEN_PARAM = "bridgeToken";
const FENIX_PRODUCTION_PORTAL_ORIGIN = "https://iaonline.io";
const DEFAULT_CODE_LAB_AGENT_ID = 9;
const PORTAL_REQUEST_TIMEOUT_MS = 15_000;

class FenixPortalHttpError extends Error {
  constructor(readonly status: number) {
    super(`La solicitud de Fenix Code ha fallado con HTTP ${status}.`);
  }
}

export type FenixPortalFailureKind = "authentication" | "configuration" | "network";

export function classifyFenixPortalFailure(cause: unknown): FenixPortalFailureKind {
  if (cause instanceof FenixPortalHttpError) {
    if ([401, 403, 404].includes(cause.status)) return "authentication";
    if (cause.status === 408 || cause.status === 429 || cause.status >= 500) return "network";
    return "configuration";
  }
  if (
    cause instanceof TypeError ||
    (cause instanceof DOMException && ["AbortError", "TimeoutError"].includes(cause.name))
  ) {
    return "network";
  }
  return "configuration";
}

const SAFE_PORTAL_ERROR_MESSAGES = new Set([
  "El token CSRF de Fenix Code Lab no está disponible.",
  "El identificador local del equipo no es válido.",
  "Fenix Code Lab returned an invalid pairing envelope.",
  "Introduce un nombre de entorno local de 1 a 80 caracteres.",
]);

export function describeFenixPortalPairingFailure(cause: unknown): string {
  if (cause instanceof FenixPortalHttpError) {
    return `La API de Fenix ha respondido con HTTP ${cause.status}.`;
  }
  if (cause instanceof Error && SAFE_PORTAL_ERROR_MESSAGES.has(cause.message)) {
    return cause.message;
  }
  if (classifyFenixPortalFailure(cause) === "network") {
    return "No se ha podido completar la conexión con Fenix.";
  }
  return "Fenix ha devuelto una respuesta de emparejamiento no válida.";
}

function portalRequestSignal(): AbortSignal {
  return AbortSignal.timeout(PORTAL_REQUEST_TIMEOUT_MS);
}

export interface FenixPortalDevice {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly revoked: boolean;
  readonly connected: boolean;
}

export interface FenixPortalBrowserTicket {
  readonly ticket: string;
  readonly expiresAt: string;
  readonly webSocketPath: string;
  readonly protocol: string;
}

export interface FenixPortalPairing {
  readonly attemptId: string;
  readonly pairingToken: string;
  readonly expiresAt: string;
}

export interface FenixPortalSession {
  readonly authenticated: true;
  readonly owner: {
    readonly companyId: number;
    readonly userId: number;
    readonly agentId: number;
  };
}

type FenixPortalBridgeAction =
  | "session"
  | "listDevices"
  | "issuePairing"
  | "revokeDevice"
  | "issueBrowserTicket";

interface FenixPortalBridgeResponse {
  readonly channel: typeof CODE_LAB_BRIDGE_CHANNEL;
  readonly bridgeToken: string;
  readonly requestId: string;
  readonly ok: boolean;
  readonly status: number;
  readonly payload?: unknown;
}

let capturedBridgeToken: string | null = null;
let capturedBridgeScope: string | null = null;

function bridgeDocumentScope(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseFenixPortalPairing(value: unknown): FenixPortalPairing {
  if (
    !isRecord(value) ||
    typeof value.attemptId !== "string" ||
    value.attemptId.length < 16 ||
    typeof value.pairingToken !== "string" ||
    value.pairingToken.length < 32 ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) {
    throw new Error("Fenix Code Lab returned an invalid pairing envelope.");
  }
  return value as unknown as FenixPortalPairing;
}

export function parseFenixPortalBrowserTicket(value: unknown): FenixPortalBrowserTicket {
  if (
    !isRecord(value) ||
    value.protocol !== CODE_LAB_PROTOCOL ||
    value.webSocketPath !== "/code-lab/ws" ||
    typeof value.ticket !== "string" ||
    value.ticket.length !== 43 ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) {
    throw new Error("Fenix Code Lab returned an invalid browser ticket.");
  }
  return value as unknown as FenixPortalBrowserTicket;
}

function isFenixPortalDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/iu.test(value);
}

function positiveAgentId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isFenixPortalEmbeddedApp(url: URL = new URL(window.location.href)): boolean {
  return url.pathname === "/code-lab" || url.pathname.startsWith(CODE_LAB_PATH_PREFIX);
}

export function readFenixPortalAgentId(url: URL = new URL(window.location.href)): number | null {
  if (!isFenixPortalEmbeddedApp(url)) return null;
  const requestedAgentId = url.searchParams.get("agentId");
  return requestedAgentId === null ? DEFAULT_CODE_LAB_AGENT_ID : positiveAgentId(requestedAgentId);
}

export function readFenixPortalBridgeToken(
  url: URL = new URL(window.location.href),
): string | null {
  if (!isFenixPortalEmbeddedApp(url)) return null;
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const token = fragment.get(CODE_LAB_BRIDGE_TOKEN_PARAM);
  if (token !== null && /^[a-f0-9]{64}$/u.test(token)) {
    capturedBridgeToken = token;
    capturedBridgeScope = bridgeDocumentScope(url);
    if (typeof window !== "undefined" && url.href === window.location.href) {
      fragment.delete(CODE_LAB_BRIDGE_TOKEN_PARAM);
      const sanitizedHash = fragment.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${sanitizedHash.length > 0 ? `#${sanitizedHash}` : ""}`,
      );
    }
    return token;
  }
  return typeof window !== "undefined" &&
    url.href === window.location.href &&
    capturedBridgeScope === bridgeDocumentScope(url)
    ? capturedBridgeToken
    : null;
}

export function isFenixPortalIsolatedBridgeApp(url: URL = new URL(window.location.href)): boolean {
  return (
    url.origin === FENIX_PRODUCTION_PORTAL_ORIGIN &&
    isFenixPortalEmbeddedApp(url) &&
    typeof window !== "undefined" &&
    window.parent !== undefined &&
    window.parent !== window &&
    readFenixPortalBridgeToken(url) !== null
  );
}

async function requestFenixPortalBridge(input: {
  readonly action: FenixPortalBridgeAction;
  readonly payload?: Record<string, unknown>;
  readonly url: URL;
}): Promise<unknown> {
  const bridgeToken = readFenixPortalBridgeToken(input.url);
  if (bridgeToken === null || window.parent === window) {
    throw new FenixPortalHttpError(401);
  }

  const requestId = window.crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      messageChannel.port1.close();
      reject(new DOMException("Fenix Code bridge timeout", "TimeoutError"));
    }, PORTAL_REQUEST_TIMEOUT_MS);

    messageChannel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const response = isRecord(event.data)
        ? (event.data as Partial<FenixPortalBridgeResponse>)
        : null;
      if (
        response === null ||
        response.channel !== CODE_LAB_BRIDGE_CHANNEL ||
        response.bridgeToken !== bridgeToken ||
        response.requestId !== requestId ||
        typeof response.ok !== "boolean" ||
        !Number.isInteger(response.status)
      ) {
        return;
      }

      window.clearTimeout(timeout);
      messageChannel.port1.close();
      if (!response.ok) {
        reject(new FenixPortalHttpError(response.status ?? 500));
        return;
      }
      resolve(response.payload);
    };

    messageChannel.port1.start();
    window.parent.postMessage(
      {
        channel: CODE_LAB_BRIDGE_CHANNEL,
        bridgeToken,
        requestId,
        action: input.action,
        payload: input.payload,
      },
      input.url.origin,
      [messageChannel.port2],
    );
  });
}

function apiUrl(path: string, url: URL): string {
  return new URL(`${CODE_LAB_API_BASE}${path}`, url.origin).toString();
}

export async function verifyFenixPortalSession(input: {
  readonly agentId: number;
  readonly fetchImpl?: typeof fetch;
  readonly url?: URL;
}): Promise<FenixPortalSession> {
  const url = input.url ?? new URL(window.location.href);
  const fetchImpl = input.fetchImpl;
  const value = (
    fetchImpl === undefined
      ? await requestFenixPortalBridge({ action: "session", url })
      : await (async () => {
          const endpoint = new URL(apiUrl("/session", url));
          endpoint.searchParams.set("agentId", String(input.agentId));
          return readJson(
            await fetchImpl(endpoint, {
              credentials: "include",
              headers: { Accept: "application/json" },
              signal: portalRequestSignal(),
            }),
          );
        })()
  ) as Partial<FenixPortalSession>;
  const owner = value.owner;
  if (
    value.authenticated !== true ||
    owner === undefined ||
    !Number.isSafeInteger(owner.companyId) ||
    owner.companyId <= 0 ||
    !Number.isSafeInteger(owner.userId) ||
    owner.userId <= 0 ||
    owner.agentId !== input.agentId
  ) {
    throw new Error("Fenix Code Lab returned an invalid authenticated session envelope.");
  }
  return value as FenixPortalSession;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new FenixPortalHttpError(response.status);
  }
  return response.json();
}

async function csrfHeader(fetchImpl: typeof fetch, url: URL): Promise<Record<string, string>> {
  const response = await fetchImpl(new URL("/api/v1/csrf/token", url.origin), {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal: portalRequestSignal(),
  });
  const envelope = (await readJson(response)) as {
    readonly token?: unknown;
    readonly data?: { readonly token?: unknown };
  };
  const token = typeof envelope.token === "string" ? envelope.token : envelope.data?.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("El token CSRF de Fenix Code Lab no está disponible.");
  }
  return { "X-CSRF-TOKEN": token };
}

export async function listFenixPortalDevices(input: {
  readonly agentId: number;
  readonly fetchImpl?: typeof fetch;
  readonly url?: URL;
}): Promise<ReadonlyArray<FenixPortalDevice>> {
  const url = input.url ?? new URL(window.location.href);
  const fetchImpl = input.fetchImpl;
  const envelope =
    fetchImpl === undefined
      ? {
          devices: (await requestFenixPortalBridge({
            action: "listDevices",
            url,
          })) as ReadonlyArray<Record<string, unknown>>,
        }
      : ((await (async () => {
          const endpoint = new URL(apiUrl("/devices", url));
          endpoint.searchParams.set("agentId", String(input.agentId));
          return readJson(
            await fetchImpl(endpoint, {
              credentials: "include",
              headers: { Accept: "application/json" },
              signal: portalRequestSignal(),
            }),
          );
        })()) as { readonly devices?: ReadonlyArray<Record<string, unknown>> });

  if (!Array.isArray(envelope.devices)) {
    throw new Error("Fenix Code Lab returned an invalid device list envelope.");
  }

  return envelope.devices.flatMap((device: Record<string, unknown>) => {
    if (
      !isFenixPortalDeviceId(device.deviceId) ||
      typeof device.deviceName !== "string" ||
      !Array.isArray(device.capabilities) ||
      device.capabilities.some((value: unknown) => typeof value !== "string") ||
      typeof device.revoked !== "boolean" ||
      typeof device.connected !== "boolean"
    ) {
      return [];
    }
    return [
      {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        capabilities: device.capabilities as ReadonlyArray<string>,
        revoked: device.revoked,
        connected: device.connected,
      },
    ];
  });
}

export async function revokeFenixPortalDevice(input: {
  readonly agentId: number;
  readonly deviceId: string;
  readonly fetchImpl?: typeof fetch;
  readonly url?: URL;
}): Promise<void> {
  const url = input.url ?? new URL(window.location.href);
  if (!isFenixPortalDeviceId(input.deviceId)) {
    throw new Error("El identificador local del equipo no es válido.");
  }
  if (input.fetchImpl === undefined) {
    await requestFenixPortalBridge({
      action: "revokeDevice",
      payload: { deviceId: input.deviceId },
      url,
    });
    return;
  }
  const fetchImpl = input.fetchImpl;
  const endpoint = new URL(apiUrl(`/devices/${encodeURIComponent(input.deviceId)}`, url));
  endpoint.searchParams.set("agentId", String(input.agentId));
  const response = await fetchImpl(endpoint, {
    method: "DELETE",
    credentials: "include",
    headers: {
      ...(await csrfHeader(fetchImpl, url)),
      Accept: "application/json",
    },
    signal: portalRequestSignal(),
  });
  if (!response.ok) {
    throw new FenixPortalHttpError(response.status);
  }
}

export async function issueFenixPortalPairing(input: {
  readonly agentId: number;
  readonly deviceName: string;
  readonly fetchImpl?: typeof fetch;
  readonly url?: URL;
}): Promise<FenixPortalPairing> {
  const url = input.url ?? new URL(window.location.href);
  const deviceName = input.deviceName.trim();
  if (deviceName.length === 0 || deviceName.length > 80) {
    throw new Error("Introduce un nombre de entorno local de 1 a 80 caracteres.");
  }
  let value: unknown;
  if (input.fetchImpl === undefined) {
    value = await requestFenixPortalBridge({
      action: "issuePairing",
      payload: { deviceName },
      url,
    });
  } else {
    const fetchImpl = input.fetchImpl;
    const headers = await csrfHeader(fetchImpl, url);
    value = await readJson(
      await fetchImpl(apiUrl("/pairings", url), {
        method: "POST",
        credentials: "include",
        headers: {
          ...headers,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId: input.agentId, deviceName }),
        signal: portalRequestSignal(),
      }),
    );
  }
  return parseFenixPortalPairing(value);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildFenixCompanionPairCommand(input: {
  readonly portalOrigin: string;
  readonly pairing: FenixPortalPairing;
}): string {
  return [
    "fenix-code fenix pair",
    `--portal ${shellQuote(new URL(input.portalOrigin).origin)}`,
    `--attempt-id ${shellQuote(input.pairing.attemptId)}`,
    `--pairing-token ${shellQuote(input.pairing.pairingToken)}`,
    '--allow-root "$PWD"',
  ].join(" ");
}

export function buildFenixMobilePairingUrl(input: {
  readonly portalOrigin: string;
  readonly pairing: FenixPortalPairing;
}): string {
  const url = new URL("fenixcode://mobile-pair");
  url.searchParams.set("portal", new URL(input.portalOrigin).origin);
  url.searchParams.set("attemptId", input.pairing.attemptId);
  url.searchParams.set("pairingToken", input.pairing.pairingToken);
  return url.toString();
}

export function buildFenixCompanionInstallCommand(input: {
  readonly artifactFileName: string;
  readonly artifactSha256: string;
  readonly distributionChannel?: "official" | "internal-qa";
  readonly portalOrigin: string;
  readonly pairing: FenixPortalPairing;
}): string {
  if (!/^Fenix-Code-Companion-[A-Za-z0-9._-]+\.tar\.gz$/u.test(input.artifactFileName)) {
    throw new Error("Fenix Code returned an invalid companion archive name.");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.artifactSha256)) {
    throw new Error("Fenix Code returned an invalid companion archive checksum.");
  }
  const directoryName = input.artifactFileName.replace(/\.tar\.gz$/u, "");
  return [
    "set -e",
    "printf 'Ruta absoluta de la carpeta local que autorizas: '",
    "IFS= read -r FENIX_CODE_ROOT",
    'case "$FENIX_CODE_ROOT" in /*) ;; *) echo "Debes indicar una ruta absoluta." >&2; exit 1 ;; esac',
    'test -d "$FENIX_CODE_ROOT" || { echo "La carpeta indicada no existe." >&2; exit 1; }',
    `FENIX_CODE_ARCHIVE="$HOME/Downloads/${input.artifactFileName}"`,
    'if [ ! -f "$FENIX_CODE_ARCHIVE" ]; then',
    "  printf 'Ruta absoluta del paquete Fenix Code descargado: '",
    "  IFS= read -r FENIX_CODE_ARCHIVE",
    "fi",
    'case "$FENIX_CODE_ARCHIVE" in /*) ;; *) echo "Debes indicar una ruta absoluta al paquete." >&2; exit 1 ;; esac',
    'test -f "$FENIX_CODE_ARCHIVE" || { echo "No se encuentra el paquete descargado." >&2; exit 1; }',
    `test "$(shasum -a 256 "$FENIX_CODE_ARCHIVE" | awk '{print $1}')" = ${shellQuote(input.artifactSha256)} || { echo "El paquete no supera la verificacion de integridad." >&2; exit 1; }`,
    'FENIX_CODE_INSTALL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fenix-code-install.XXXXXX")"',
    "trap 'rm -rf \"$FENIX_CODE_INSTALL_DIR\"' EXIT",
    'tar -xzf "$FENIX_CODE_ARCHIVE" -C "$FENIX_CODE_INSTALL_DIR"',
    `cd "$FENIX_CODE_INSTALL_DIR"/${shellQuote(directoryName)}`,
    [
      "./install.sh",
      ...(input.distributionChannel === "internal-qa" ? ["--accept-unnotarized-internal-qa"] : []),
      `--portal ${shellQuote(new URL(input.portalOrigin).origin)}`,
      `--attempt-id ${shellQuote(input.pairing.attemptId)}`,
      `--pairing-token ${shellQuote(input.pairing.pairingToken)}`,
      '--allow-root "$FENIX_CODE_ROOT"',
    ].join(" "),
  ].join("\n");
}

export async function issueFenixPortalBrowserTicket(input: {
  readonly agentId: number;
  readonly deviceId: string;
  readonly fetchImpl?: typeof fetch;
  readonly url?: URL;
}): Promise<FenixPortalBrowserTicket> {
  const url = input.url ?? new URL(window.location.href);
  if (!isFenixPortalDeviceId(input.deviceId)) {
    throw new Error("El identificador local del equipo no es válido.");
  }
  let value: unknown;
  if (input.fetchImpl === undefined) {
    value = await requestFenixPortalBridge({
      action: "issueBrowserTicket",
      payload: { deviceId: input.deviceId },
      url,
    });
  } else {
    const fetchImpl = input.fetchImpl;
    const headers = await csrfHeader(fetchImpl, url);
    value = await readJson(
      await fetchImpl(apiUrl(`/devices/${encodeURIComponent(input.deviceId)}/ticket`, url), {
        method: "POST",
        credentials: "include",
        headers: {
          ...headers,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agentId: input.agentId }),
        signal: portalRequestSignal(),
      }),
    );
  }
  return parseFenixPortalBrowserTicket(value);
}

export function fenixPortalSocket(input: {
  readonly ticket: FenixPortalBrowserTicket;
  readonly url?: URL;
}): { readonly socketUrl: string; readonly protocols: ReadonlyArray<string> } {
  const url = input.url ?? new URL(window.location.href);
  const ticket = parseFenixPortalBrowserTicket(input.ticket);
  const socket = new URL(ticket.webSocketPath, url.origin);
  socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
  return {
    socketUrl: socket.toString(),
    protocols: [CODE_LAB_PROTOCOL, `${CODE_LAB_TICKET_PREFIX}${ticket.ticket}`],
  };
}

export function fenixPortalDeviceRegistration(
  device: FenixPortalDevice,
): PlatformConnectionRegistration {
  return new FenixCompanionConnectionRegistration({
    target: new FenixCompanionConnectionTarget({
      environmentId: EnvironmentId.make(`fenix-code-lab:${device.deviceId}`),
      label: device.deviceName,
      deviceId: device.deviceId,
    }),
  });
}

export function fenixPortalConnectedDeviceRegistrations(
  devices: ReadonlyArray<FenixPortalDevice>,
): ReadonlyArray<PlatformConnectionRegistration> {
  return devices
    .filter((device) => device.connected && !device.revoked)
    .map(fenixPortalDeviceRegistration);
}
