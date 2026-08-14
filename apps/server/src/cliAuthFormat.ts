import type { AuthClientMetadata, AuthClientSession, AuthPairingLink } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { IssuedBearerSession, IssuedPairingLink } from "./auth/EnvironmentAuth.ts";

const newline = "\n";

function serializeOptionalFields(values: ReadonlyArray<string | null | undefined>) {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function formatClientMetadata(metadata: AuthClientMetadata): string {
  const details = serializeOptionalFields([
    metadata.label,
    metadata.deviceType !== "unknown" ? metadata.deviceType : undefined,
    metadata.os,
    metadata.browser,
    metadata.ipAddress,
  ]);
  return details.length > 0 ? details.join(" | ") : "cliente sin etiqueta";
}

function toIsoString(value: DateTime.DateTime | DateTime.Utc): string {
  return DateTime.formatIso(DateTime.toUtc(value));
}

export function formatIssuedPairingCredential(
  credential: IssuedPairingLink,
  options?: {
    readonly json?: boolean;
    readonly baseUrl?: string;
  },
): string {
  const pairUrl =
    options?.baseUrl != null && options.baseUrl.length > 0
      ? (() => {
          const url = new URL("/pair", options.baseUrl);
          url.searchParams.delete("token");
          url.hash = new URLSearchParams([["token", credential.credential]]).toString();
          return url.toString();
        })()
      : undefined;

  if (options?.json) {
    return `${JSON.stringify(
      {
        id: credential.id,
        credential: credential.credential,
        ...(credential.label ? { label: credential.label } : {}),
        scopes: credential.scopes,
        expiresAt: toIsoString(credential.expiresAt),
        ...(pairUrl ? { pairUrl } : {}),
      },
      null,
      2,
    )}${newline}`;
  }

  return (
    [
      `Token de emparejamiento ${credential.id} emitido.`,
      `Token: ${credential.credential}`,
      ...(pairUrl ? [`URL de emparejamiento: ${pairUrl}`] : []),
      `Caduca: ${credential.expiresAt}`,
    ].join(newline) + newline
  );
}

export function formatPairingCredentialList(
  credentials: ReadonlyArray<AuthPairingLink>,
  options?: {
    readonly json?: boolean;
  },
): string {
  if (options?.json) {
    return `${JSON.stringify(
      credentials.map((credential) => ({
        id: credential.id,
        ...(credential.label ? { label: credential.label } : {}),
        scopes: credential.scopes,
        createdAt: toIsoString(credential.createdAt),
        expiresAt: toIsoString(credential.expiresAt),
      })),
      null,
      2,
    )}${newline}`;
  }

  if (credentials.length === 0) {
    return `No hay emparejamientos activos.${newline}`;
  }

  return (
    credentials
      .map((credential) =>
        [
          `${credential.id}${credential.label ? ` (${credential.label})` : ""}`,
          `  permisos: ${credential.scopes.join(" ")}`,
          `  creado: ${toIsoString(credential.createdAt)}`,
          `  caduca: ${toIsoString(credential.expiresAt)}`,
        ].join(newline),
      )
      .join(`${newline}${newline}`) + newline
  );
}

export function formatIssuedSession(
  session: IssuedBearerSession,
  options?: {
    readonly json?: boolean;
    readonly tokenOnly?: boolean;
  },
): string {
  if (options?.tokenOnly) {
    return `${session.token}${newline}`;
  }

  if (options?.json) {
    return `${JSON.stringify(
      {
        sessionId: session.sessionId,
        token: session.token,
        method: session.method,
        scopes: session.scopes,
        subject: session.subject,
        client: session.client,
        expiresAt: toIsoString(session.expiresAt),
      },
      null,
      2,
    )}${newline}`;
  }

  return (
    [
      `Token de acceso ${session.sessionId} emitido.`,
      `Permisos: ${session.scopes.join(" ")}`,
      `Token: ${session.token}`,
      `Sujeto: ${session.subject}`,
      `Cliente: ${formatClientMetadata(session.client)}`,
      `Caduca: ${toIsoString(session.expiresAt)}`,
    ].join(newline) + newline
  );
}

export function formatSessionList(
  sessions: ReadonlyArray<AuthClientSession>,
  options?: {
    readonly json?: boolean;
  },
): string {
  if (options?.json) {
    return `${JSON.stringify(
      sessions.map((session) => ({
        sessionId: session.sessionId,
        method: session.method,
        scopes: session.scopes,
        subject: session.subject,
        client: session.client,
        connected: session.connected,
        issuedAt: toIsoString(session.issuedAt),
        expiresAt: toIsoString(session.expiresAt),
        lastConnectedAt: session.lastConnectedAt ? toIsoString(session.lastConnectedAt) : null,
      })),
      null,
      2,
    )}${newline}`;
  }

  if (sessions.length === 0) {
    return `No hay sesiones activas.${newline}`;
  }

  return (
    sessions
      .map((session) =>
        [
          `${session.sessionId}${session.connected ? " conectado" : ""}`,
          `  permisos: ${session.scopes.join(" ")}`,
          `  método: ${session.method}`,
          `  sujeto: ${session.subject}`,
          `  cliente: ${formatClientMetadata(session.client)}`,
          `  emitido: ${toIsoString(session.issuedAt)}`,
          `  última conexión: ${
            session.lastConnectedAt ? toIsoString(session.lastConnectedAt) : "nunca"
          }`,
          `  caduca: ${toIsoString(session.expiresAt)}`,
        ].join(newline),
      )
      .join(`${newline}${newline}`) + newline
  );
}
