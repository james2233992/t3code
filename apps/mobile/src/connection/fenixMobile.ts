import { p256 } from "@noble/curves/nist";
import { EnvironmentId } from "@t3tools/contracts";
import {
  FenixCompanionConnectionRegistration,
  FenixCompanionConnectionTarget,
  type PlatformConnectionRegistration,
} from "@t3tools/client-runtime/connection";
import * as Encoding from "effect/Encoding";
import Constants from "expo-constants";
import * as ExpoCrypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const MOBILE_CONTROLLER_STORAGE_KEY = "fenix.code.mobile-controller.v1";
const MOBILE_PAIRING_SCHEME = "fenixcode:";
const MOBILE_PAIRING_HOST = "mobile-pair";
const CODE_LAB_PROTOCOL = "fenix-code-lab-v1";
const CODE_LAB_TICKET_PREFIX = "fenix-code-lab-ticket.";
const REQUEST_TIMEOUT_MS = 15_000;
const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
  0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

export interface FenixMobilePairingRequest {
  readonly portalOrigin: string;
  readonly attemptId: string;
  readonly pairingToken: string;
}

export interface FenixMobileControllerRecord {
  readonly portalOrigin: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly deviceCredential: string;
  readonly pairedAt: string;
}

export interface FenixMobileTarget {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly capabilities: ReadonlyArray<string>;
}

export interface FenixMobileBrowserTicket {
  readonly ticket: string;
  readonly expiresAt: string;
  readonly webSocketPath: "/code-lab/ws";
  readonly protocol: "fenix-code-lab-v1";
}

export interface FenixMobileAccessAuthorization {
  readonly controller: FenixMobileControllerRecord;
  readonly targets: ReadonlyArray<FenixMobileTarget>;
}

interface MobileCredentialStorage {
  readonly getItemAsync: (key: string) => Promise<string | null>;
  readonly setItemAsync: (
    key: string,
    value: string,
    options?: SecureStore.SecureStoreOptions,
  ) => Promise<void>;
  readonly deleteItemAsync: (key: string) => Promise<void>;
}

export class FenixMobileHttpError extends Error {
  constructor(readonly status: number) {
    super(`Fenix mobile controller request failed with HTTP ${status}.`);
  }
}

function configuredPortalOrigin(): string {
  const candidate = Constants.expoConfig?.extra?.fenixPortal?.origin;
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return "https://iaonline.io";
  }
  return new URL(candidate).origin;
}

function exactPortalOrigin(candidate: string, expected = configuredPortalOrigin()): string {
  const portal = new URL(candidate);
  const expectedOrigin = new URL(expected).origin;
  const isSecure = portal.protocol === "https:";
  const isLoopback =
    portal.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(portal.hostname);
  if ((!isSecure && !isLoopback) || portal.origin !== expectedOrigin) {
    throw new Error("The mobile pairing QR is not bound to the configured Fenix portal.");
  }
  return portal.origin;
}

export function isFenixMobilePairingUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === MOBILE_PAIRING_SCHEME && url.hostname === MOBILE_PAIRING_HOST;
  } catch {
    return false;
  }
}

export function parseFenixMobilePairingUrl(
  value: string,
  expectedPortalOrigin = configuredPortalOrigin(),
): FenixMobilePairingRequest {
  const url = new URL(value.trim());
  if (url.protocol !== MOBILE_PAIRING_SCHEME || url.hostname !== MOBILE_PAIRING_HOST) {
    throw new Error("This QR code is not a Fenix mobile pairing request.");
  }
  const portalOrigin = exactPortalOrigin(
    url.searchParams.get("portal") ?? "",
    expectedPortalOrigin,
  );
  const attemptId = url.searchParams.get("attemptId")?.trim() ?? "";
  const pairingToken = url.searchParams.get("pairingToken")?.trim() ?? "";
  if (attemptId.length < 16 || pairingToken.length < 32) {
    throw new Error("The Fenix mobile pairing request is incomplete or expired.");
  }
  return { portalOrigin, attemptId, pairingToken };
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function publicKeyPem(publicKey: Uint8Array): string {
  const base64 = Encoding.encodeBase64(concatBytes(P256_SPKI_PREFIX, publicKey));
  const lines = base64.match(/.{1,64}/gu) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

async function pairingProof(input: FenixMobilePairingRequest): Promise<{
  readonly publicKeyPem: string;
  readonly proofBase64: string;
}> {
  let privateKey: Uint8Array;
  do {
    privateKey = ExpoCrypto.getRandomBytes(p256.CURVE.nByteLength);
  } while (!p256.utils.isValidPrivateKey(privateKey));
  const payload = new TextEncoder().encode(
    `fenix-code-lab-pair-v1\n${input.attemptId}\n${input.pairingToken}`,
  );
  const digest = new Uint8Array(
    await ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, payload),
  );
  const signature = p256.sign(digest, privateKey, { prehash: false }).toCompactRawBytes();
  return {
    publicKeyPem: publicKeyPem(p256.getPublicKey(privateKey, false)),
    proofBase64: Encoding.encodeBase64(signature),
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new FenixMobileHttpError(response.status);
  return response.json();
}

async function postJson(url: URL, body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await readJson(
      await fetchImpl(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseControllerRecord(value: unknown): FenixMobileControllerRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<FenixMobileControllerRecord>;
  if (
    typeof candidate.portalOrigin !== "string" ||
    typeof candidate.deviceId !== "string" ||
    candidate.deviceId.length < 16 ||
    typeof candidate.deviceName !== "string" ||
    typeof candidate.deviceCredential !== "string" ||
    candidate.deviceCredential.length < 32 ||
    typeof candidate.pairedAt !== "string"
  ) {
    return null;
  }
  try {
    return {
      ...candidate,
      portalOrigin: exactPortalOrigin(candidate.portalOrigin),
    } as FenixMobileControllerRecord;
  } catch {
    return null;
  }
}

export async function loadFenixMobileController(
  storage: MobileCredentialStorage = SecureStore,
): Promise<FenixMobileControllerRecord | null> {
  const raw = await storage.getItemAsync(MOBILE_CONTROLLER_STORAGE_KEY);
  if (raw === null) return null;
  try {
    return parseControllerRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function clearFenixMobileController(
  storage: MobileCredentialStorage = SecureStore,
): Promise<void> {
  await storage.deleteItemAsync(MOBILE_CONTROLLER_STORAGE_KEY);
}

export async function authorizeFenixMobileController(
  input: {
    readonly fetchImpl?: typeof fetch;
    readonly storage?: MobileCredentialStorage;
  } = {},
): Promise<FenixMobileAccessAuthorization | null> {
  const storage = input.storage ?? SecureStore;
  const controller = await loadFenixMobileController(storage);
  if (controller === null) return null;

  try {
    const targets = await listFenixMobileTargets({
      controller,
      fetchImpl: input.fetchImpl,
    });
    return { controller, targets };
  } catch (error) {
    if (error instanceof FenixMobileHttpError && [401, 403].includes(error.status)) {
      await clearFenixMobileController(storage);
      return null;
    }
    throw error;
  }
}

export async function pairFenixMobileController(input: {
  readonly pairingUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly storage?: MobileCredentialStorage;
  readonly deviceName?: string;
  readonly expectedPortalOrigin?: string;
}): Promise<FenixMobileControllerRecord> {
  const pairing = parseFenixMobilePairingUrl(input.pairingUrl, input.expectedPortalOrigin);
  const proof = await pairingProof(pairing);
  const value = (await postJson(
    new URL("/api/v1/code-lab/companion/pairings/consume", pairing.portalOrigin),
    {
      attemptId: pairing.attemptId,
      pairingToken: pairing.pairingToken,
      publicKeyPem: proof.publicKeyPem,
      proofBase64: proof.proofBase64,
      capabilities: ["mobile_controller"],
    },
    input.fetchImpl ?? fetch,
  )) as {
    readonly device?: {
      readonly deviceId?: unknown;
      readonly deviceName?: unknown;
      readonly pairedAt?: unknown;
    };
    readonly deviceCredential?: unknown;
  };
  const record = parseControllerRecord({
    portalOrigin: pairing.portalOrigin,
    deviceId: value.device?.deviceId,
    deviceName:
      value.device?.deviceName ?? input.deviceName ?? Constants.deviceName ?? "Fenix Mobile",
    deviceCredential: value.deviceCredential,
    pairedAt: value.device?.pairedAt ?? new Date().toISOString(),
  });
  if (record === null) throw new Error("Fenix returned an invalid mobile device envelope.");
  await (input.storage ?? SecureStore).setItemAsync(
    MOBILE_CONTROLLER_STORAGE_KEY,
    JSON.stringify(record),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  return record;
}

export async function listFenixMobileTargets(
  input: {
    readonly controller?: FenixMobileControllerRecord;
    readonly fetchImpl?: typeof fetch;
  } = {},
): Promise<ReadonlyArray<FenixMobileTarget>> {
  const controller = input.controller ?? (await loadFenixMobileController());
  if (controller === null) return [];
  const value = (await postJson(
    new URL(
      `/api/v1/code-lab/mobile/devices/${encodeURIComponent(controller.deviceId)}/targets`,
      controller.portalOrigin,
    ),
    { deviceCredential: controller.deviceCredential },
    input.fetchImpl ?? fetch,
  )) as { readonly targets?: ReadonlyArray<Record<string, unknown>> };
  return (value.targets ?? []).flatMap((target) => {
    if (
      typeof target.deviceId !== "string" ||
      target.deviceId.length < 16 ||
      typeof target.deviceName !== "string" ||
      !Array.isArray(target.capabilities) ||
      target.capabilities.some((entry) => typeof entry !== "string") ||
      !target.capabilities.includes("local_runner") ||
      !target.capabilities.includes("rpc") ||
      !target.capabilities.includes("workspace.local")
    ) {
      return [];
    }
    return [
      {
        deviceId: target.deviceId,
        deviceName: target.deviceName,
        capabilities: target.capabilities as ReadonlyArray<string>,
      },
    ];
  });
}

export async function issueFenixMobileTargetTicket(input: {
  readonly deviceId: string;
  readonly controller?: FenixMobileControllerRecord;
  readonly fetchImpl?: typeof fetch;
}): Promise<{ readonly ticket: FenixMobileBrowserTicket; readonly portalOrigin: string }> {
  const controller = input.controller ?? (await loadFenixMobileController());
  if (controller === null)
    throw new Error("Pair this mobile device from your Fenix session first.");
  const value = (await postJson(
    new URL(
      `/api/v1/code-lab/mobile/devices/${encodeURIComponent(controller.deviceId)}/targets/${encodeURIComponent(input.deviceId)}/ticket`,
      controller.portalOrigin,
    ),
    { deviceCredential: controller.deviceCredential },
    input.fetchImpl ?? fetch,
  )) as Partial<FenixMobileBrowserTicket>;
  const expiresAtMs = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
  if (
    value.protocol !== CODE_LAB_PROTOCOL ||
    value.webSocketPath !== "/code-lab/ws" ||
    typeof value.ticket !== "string" ||
    value.ticket.length !== 43 ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now()
  ) {
    throw new Error("Fenix returned an invalid mobile browser ticket.");
  }
  return { ticket: value as FenixMobileBrowserTicket, portalOrigin: controller.portalOrigin };
}

export function fenixMobileSocket(input: {
  readonly ticket: FenixMobileBrowserTicket;
  readonly portalOrigin: string;
}): { readonly socketUrl: string; readonly protocols: ReadonlyArray<string> } {
  const expiresAtMs = Date.parse(input.ticket.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error("The Fenix mobile browser ticket has expired.");
  }
  const socket = new URL(input.ticket.webSocketPath, exactPortalOrigin(input.portalOrigin));
  socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
  return {
    socketUrl: socket.toString(),
    protocols: [CODE_LAB_PROTOCOL, `${CODE_LAB_TICKET_PREFIX}${input.ticket.ticket}`],
  };
}

export function fenixMobileTargetRegistration(
  target: FenixMobileTarget,
): PlatformConnectionRegistration {
  return new FenixCompanionConnectionRegistration({
    target: new FenixCompanionConnectionTarget({
      environmentId: EnvironmentId.make(`fenix-code-lab:${target.deviceId}`),
      label: target.deviceName,
      deviceId: target.deviceId,
    }),
  });
}
