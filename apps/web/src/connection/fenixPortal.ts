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
const DEFAULT_CODE_LAB_AGENT_ID = 9;
const PORTAL_REQUEST_TIMEOUT_MS = 15_000;

class FenixPortalHttpError extends Error {
  constructor(readonly status: number) {
    super(`Fenix Code Lab request failed with HTTP ${status}.`);
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

function portalRequestSignal(): AbortSignal {
  return AbortSignal.timeout(PORTAL_REQUEST_TIMEOUT_MS);
}

export interface FenixPortalDevice {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly revoked: boolean;
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

function apiUrl(path: string, url: URL): string {
  return new URL(`${CODE_LAB_API_BASE}${path}`, url.origin).toString();
}

export async function verifyFenixPortalSession(input: {
  readonly agentId: number;
  readonly fetchImpl?: typeof fetch;
  readonly url?: URL;
}): Promise<FenixPortalSession> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = input.url ?? new URL(window.location.href);
  const endpoint = new URL(apiUrl("/session", url));
  endpoint.searchParams.set("agentId", String(input.agentId));
  const value = (await readJson(
    await fetchImpl(endpoint, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: portalRequestSignal(),
    }),
  )) as Partial<FenixPortalSession>;
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
    readonly data?: { readonly token?: unknown };
  };
  if (typeof envelope.data?.token !== "string" || envelope.data.token.length === 0) {
    throw new Error("Fenix Code Lab CSRF token is unavailable.");
  }
  return { "X-CSRF-TOKEN": envelope.data.token };
}

export async function listFenixPortalDevices(input: {
  readonly agentId: number;
  readonly fetchImpl?: typeof fetch;
  readonly url?: URL;
}): Promise<ReadonlyArray<FenixPortalDevice>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = input.url ?? new URL(window.location.href);
  const endpoint = new URL(apiUrl("/devices", url));
  endpoint.searchParams.set("agentId", String(input.agentId));
  const envelope = (await readJson(
    await fetchImpl(endpoint, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: portalRequestSignal(),
    }),
  )) as { readonly devices?: ReadonlyArray<Record<string, unknown>> };

  return (envelope.devices ?? []).flatMap((device) => {
    if (
      typeof device.deviceId !== "string" ||
      device.deviceId.length < 16 ||
      typeof device.deviceName !== "string" ||
      !Array.isArray(device.capabilities) ||
      device.capabilities.some((value) => typeof value !== "string") ||
      typeof device.revoked !== "boolean"
    ) {
      return [];
    }
    return [
      {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        capabilities: device.capabilities as ReadonlyArray<string>,
        revoked: device.revoked,
      },
    ];
  });
}

export async function issueFenixPortalPairing(input: {
  readonly agentId: number;
  readonly deviceName: string;
  readonly fetchImpl?: typeof fetch;
  readonly url?: URL;
}): Promise<FenixPortalPairing> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = input.url ?? new URL(window.location.href);
  const deviceName = input.deviceName.trim();
  if (deviceName.length === 0 || deviceName.length > 80) {
    throw new Error("Enter a local environment name of 1 to 80 characters.");
  }
  const headers = await csrfHeader(fetchImpl, url);
  const value = (await readJson(
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
  )) as Partial<FenixPortalPairing>;
  if (
    typeof value.attemptId !== "string" ||
    value.attemptId.length < 16 ||
    typeof value.pairingToken !== "string" ||
    value.pairingToken.length < 32 ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) {
    throw new Error("Fenix Code Lab returned an invalid pairing envelope.");
  }
  return value as FenixPortalPairing;
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

export function buildFenixCompanionInstallCommand(input: {
  readonly artifactFileName: string;
  readonly portalOrigin: string;
  readonly pairing: FenixPortalPairing;
}): string {
  if (!/^Fenix-Code-Companion-[A-Za-z0-9._-]+\.tar\.gz$/u.test(input.artifactFileName)) {
    throw new Error("Fenix Code returned an invalid companion archive name.");
  }
  const directoryName = input.artifactFileName.replace(/\.tar\.gz$/u, "");
  return [
    "printf 'Ruta absoluta de la carpeta local que autorizas: '",
    "IFS= read -r FENIX_CODE_ROOT",
    'test -d "$FENIX_CODE_ROOT" || { echo "La carpeta indicada no existe." >&2; exit 1; }',
    "cd ~/Downloads",
    `tar -xzf ${shellQuote(input.artifactFileName)}`,
    `cd ${shellQuote(directoryName)}`,
    [
      "./install.sh",
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
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = input.url ?? new URL(window.location.href);
  const headers = await csrfHeader(fetchImpl, url);
  const value = (await readJson(
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
  )) as Partial<FenixPortalBrowserTicket>;
  if (
    value.protocol !== CODE_LAB_PROTOCOL ||
    value.webSocketPath !== "/code-lab/ws" ||
    typeof value.ticket !== "string" ||
    value.ticket.length !== 43 ||
    typeof value.expiresAt !== "string"
  ) {
    throw new Error("Fenix Code Lab returned an invalid browser ticket.");
  }
  return value as FenixPortalBrowserTicket;
}

export function fenixPortalSocket(input: {
  readonly ticket: FenixPortalBrowserTicket;
  readonly url?: URL;
}): { readonly socketUrl: string; readonly protocols: ReadonlyArray<string> } {
  const url = input.url ?? new URL(window.location.href);
  const socket = new URL(input.ticket.webSocketPath, url.origin);
  socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
  return {
    socketUrl: socket.toString(),
    protocols: [CODE_LAB_PROTOCOL, `${CODE_LAB_TICKET_PREFIX}${input.ticket.ticket}`],
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
