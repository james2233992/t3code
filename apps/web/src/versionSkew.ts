import type { EnvironmentId, ServerConfig, ServerSelfUpdateCapability } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { APP_VERSION } from "./branding";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

export interface VersionMismatch {
  readonly clientVersion: string;
  readonly serverVersion: string;
  readonly hint: string;
}

export const VERSION_MISMATCH_DISMISSALS_STORAGE_KEY = "t3code:version-mismatch-dismissals:v1";

const VersionMismatchDismissalsSchema = Schema.Struct({
  keys: Schema.Array(Schema.String),
});

type VersionMismatchDismissals = typeof VersionMismatchDismissalsSchema.Type;

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveVersionMismatch(
  serverVersion: string | null | undefined,
): VersionMismatch | null {
  const normalizedClientVersion = normalizeVersion(APP_VERSION);
  const normalizedServerVersion = normalizeVersion(serverVersion);
  if (
    !normalizedClientVersion ||
    !normalizedServerVersion ||
    normalizedClientVersion === normalizedServerVersion
  ) {
    return null;
  }

  return {
    clientVersion: normalizedClientVersion,
    serverVersion: normalizedServerVersion,
    hint: "Las versiones no coinciden. Sincroniza el cliente y el servidor con la misma versión de Fenix Code.",
  };
}

export function resolveServerConfigVersionMismatch(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): VersionMismatch | null {
  return resolveVersionMismatch(serverConfig?.environment.serverVersion);
}

/** The update path the connected server offers, or null when it only
    supports a manual relaunch (older servers, dev checkouts, Windows). */
export function resolveServerSelfUpdateCapability(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): ServerSelfUpdateCapability | null {
  return serverConfig?.environment.capabilities.serverSelfUpdate ?? null;
}

/** The command to hand users whose server cannot update itself. */
export function manualServerUpdateCommand(targetVersion: string): string {
  void targetVersion;
  return "fenix-code service update";
}

/** One sentence telling the user how to resolve version skew for a server,
    matched to the update path it offers. */
export function serverUpdateGuidance(
  capability: ServerSelfUpdateCapability | null,
  serverLabel: string,
): string {
  switch (capability) {
    case "boot-service":
    case "respawn":
      return `Actualiza ${serverLabel} para mantener las versiones sincronizadas.`;
    case "desktop-managed":
      return `${serverLabel} se ejecuta mediante la aplicación de escritorio Fenix Code de ese equipo. Actualízala allí para sincronizar las versiones.`;
    default:
      return `Reinicia ${serverLabel} con el comando copiado para sincronizar las versiones.`;
  }
}

export function buildVersionMismatchDismissalKey(
  environmentId: EnvironmentId,
  mismatch: Pick<VersionMismatch, "clientVersion" | "serverVersion">,
): string {
  return `${environmentId}:${mismatch.clientVersion}:${mismatch.serverVersion}`;
}

function readVersionMismatchDismissals(): VersionMismatchDismissals {
  try {
    return (
      getLocalStorageItem(
        VERSION_MISMATCH_DISMISSALS_STORAGE_KEY,
        VersionMismatchDismissalsSchema,
      ) ?? { keys: [] }
    );
  } catch (error) {
    console.error("No se pudieron leer los avisos de versiones descartados.", error);
    return { keys: [] };
  }
}

function writeVersionMismatchDismissals(document: VersionMismatchDismissals): void {
  try {
    setLocalStorageItem(
      VERSION_MISMATCH_DISMISSALS_STORAGE_KEY,
      document,
      VersionMismatchDismissalsSchema,
    );
  } catch (error) {
    console.error("No se pudieron guardar los avisos de versiones descartados.", error);
  }
}

export function isVersionMismatchDismissed(dismissalKey: string | null | undefined): boolean {
  if (!dismissalKey) {
    return false;
  }
  return readVersionMismatchDismissals().keys.includes(dismissalKey);
}

export function dismissVersionMismatch(dismissalKey: string | null | undefined): void {
  if (!dismissalKey) {
    return;
  }
  const document = readVersionMismatchDismissals();
  if (document.keys.includes(dismissalKey)) {
    return;
  }
  writeVersionMismatchDismissals({
    keys: [...document.keys, dismissalKey],
  });
}

export function appendVersionMismatchHint(
  message: string | null | undefined,
  mismatch: VersionMismatch | null | undefined,
): string | null {
  const normalizedMessage = normalizeVersion(message);
  if (!normalizedMessage) {
    return mismatch?.hint ?? null;
  }
  if (!mismatch) {
    return normalizedMessage;
  }
  return `${normalizedMessage} Sugerencia: ${mismatch.hint}`;
}
