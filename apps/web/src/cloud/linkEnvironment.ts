import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import {
  EnvironmentCloudEndpointUnavailableError,
  type EnvironmentCloudLinkStateResult,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
  EnvironmentHttpForbiddenError,
  EnvironmentHttpInternalServerError,
  EnvironmentHttpUnauthorizedError,
  EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import {
  type RelayClientDeviceRecord,
  type RelayClientEnvironmentRecord,
  type RelayEnvironmentLinkResponse,
  type RelayProtectedError as RelayProtectedErrorType,
  type RelayManagedEndpointProviderKind,
} from "@t3tools/contracts/relay";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request, runStream } from "@t3tools/client-runtime/rpc";
import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";
import { ManagedRelay } from "@t3tools/client-runtime/relay";

import {
  readPrimaryEnvironmentDescriptor,
  readPrimaryEnvironmentTarget,
} from "../environments/primary";
import { primaryEnvironmentHttpLayer } from "../environments/primary/httpLayer";
import { resolveCloudPublicConfig } from "./publicConfig";
import {
  finishRelayClientInstall,
  reportRelayClientInstallProgress,
  requestRelayClientInstallConfirmation,
} from "./relayClientInstallDialog";

export function normalizeRelayBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/g, "");
}

function relayUrl(): string | null {
  return resolveCloudPublicConfig().relayUrl;
}

export class CloudEnvironmentLinkError extends Data.TaggedError("CloudEnvironmentLinkError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly traceId?: string;
}> {}

const relayClientRpcError = (message: string) => (cause: unknown) =>
  new CloudEnvironmentLinkError({
    message,
    cause,
  });

function ensureRelayClientAvailable(
  environmentId: EnvironmentId,
): Effect.Effect<void, CloudEnvironmentLinkError, EnvironmentRegistry> {
  return Effect.gen(function* () {
    const registry = yield* EnvironmentRegistry;
    const status = yield* registry
      .run(environmentId, request(WS_METHODS.cloudGetRelayClientStatus, {}))
      .pipe(
        Effect.mapError(
          relayClientRpcError(
            "No se pudo comprobar la disponibilidad del cliente de retransmisión.",
          ),
        ),
      );
    if (status.status === "available") return;
    if (status.status === "unsupported") {
      return yield* new CloudEnvironmentLinkError({
        message: `Fenix Code no puede instalar automáticamente el cliente de retransmisión en ${status.platform}-${status.arch}.`,
      });
    }

    const confirmed = yield* Effect.tryPromise({
      try: () => requestRelayClientInstallConfirmation(status.version),
      catch: relayClientRpcError(
        "No se pudo confirmar la instalación del cliente de retransmisión.",
      ),
    });
    if (!confirmed) {
      return yield* new CloudEnvironmentLinkError({
        message: "Se canceló la instalación del cliente de retransmisión.",
      });
    }

    const installed = yield* registry
      .runStream(
        environmentId,
        runStream(WS_METHODS.cloudInstallRelayClient, {}).pipe(
          Stream.tap((event) => Effect.sync(() => reportRelayClientInstallProgress(event))),
        ),
      )
      .pipe(
        Stream.runLast,
        Effect.mapError(relayClientRpcError("No se pudo instalar el cliente de retransmisión.")),
        Effect.ensuring(Effect.sync(finishRelayClientInstall)),
      );
    if (Option.isNone(installed) || installed.value.type !== "complete") {
      return yield* new CloudEnvironmentLinkError({
        message: "La instalación del cliente de retransmisión terminó sin un estado final.",
      });
    }
    const installedStatus = installed.value.status;
    if (installedStatus.status !== "available") {
      return yield* new CloudEnvironmentLinkError({
        message:
          installedStatus.status === "unsupported"
            ? `Fenix Code no puede instalar automáticamente el cliente de retransmisión en ${installedStatus.platform}-${installedStatus.arch}.`
            : "El cliente de retransmisión sigue sin estar disponible tras la instalación.",
      });
    }
  });
}

const isEnvironmentCloudApiError = Schema.is(
  Schema.Union([
    EnvironmentHttpBadRequestError,
    EnvironmentHttpUnauthorizedError,
    EnvironmentHttpForbiddenError,
    EnvironmentHttpConflictError,
    EnvironmentHttpInternalServerError,
    EnvironmentCloudEndpointUnavailableError,
  ]),
);

function relayProtectedErrorMessage(error: RelayProtectedErrorType): string {
  switch (error._tag) {
    case "RelayAuthInvalidError":
      switch (error.reason) {
        case "missing_bearer":
        case "invalid_bearer":
          return "El servicio de retransmisión rechazó el token de sesión en la nube.";
        case "invalid_dpop":
          return "El servicio de retransmisión rechazó la prueba DPoP.";
        case "not_authorized":
          return "El servicio de retransmisión rechazó la solicitud autenticada.";
      }
    case "RelayEnvironmentLinkProofExpiredError":
      return "El servicio de retransmisión rechazó una prueba de enlace de entorno caducada.";
    case "RelayEnvironmentLinkProofInvalidError":
      return `El servicio de retransmisión rechazó la prueba de enlace del entorno (${error.reason}).`;
    case "RelayEnvironmentConnectNotAuthorizedError":
      // "Not authorized" covers non-auth causes too; surface the reason so a
      // missing link doesn't read as a credential problem.
      if (error.reason === "environment_link_not_found") {
        return "La retransmisión no tiene un enlace activo para este entorno. Es posible que el servidor todavía no lo haya restablecido.";
      }
      return error.reason
        ? `El servicio de retransmisión rechazó la solicitud de conexión del entorno (${error.reason}).`
        : "El servicio de retransmisión rechazó la solicitud de conexión del entorno.";
    case "RelayEnvironmentEndpointUnavailableError":
      return `El servicio de retransmisión no pudo alcanzar el endpoint del entorno (${error.reason}).`;
    case "RelayEnvironmentEndpointTimedOutError":
      return "La retransmisión agotó el tiempo de espera al contactar con el endpoint del entorno.";
    case "RelayEnvironmentLinkFailedError":
      return `El servicio de retransmisión no pudo enlazar el entorno (${error.reason}).`;
    case "RelayEnvironmentLinkUnavailableError":
      return `El servicio de retransmisión no puede aprovisionar el endpoint gestionado (${error.reason}).`;
    case "RelayEnvironmentLinkLimitExceededError":
      return `El servicio de retransmisión rechazó el enlace: esta cuenta ya tiene el máximo de ${error.maxTunnels} túneles gestionados. Desvincula un entorno para liberar uno.`;
    case "RelayAgentActivityPublishProofExpiredError":
      return "El servicio de retransmisión rechazó una prueba caducada de publicación de actividad.";
    case "RelayAgentActivityPublishProofInvalidError":
      return `El servicio de retransmisión rechazó la prueba de publicación de actividad (${error.reason}).`;
    case "RelayInternalError":
      return `Relay encountered an internal error (${error.reason}).`;
  }
}

function decodedRelayClientError(message: string) {
  return (cause: ManagedRelay.ManagedRelayClientError) => {
    const relayError =
      cause._tag === "ManagedRelayRequestFailedError" ? cause.relayError : undefined;
    const traceId = cause._tag === "ManagedRelayRequestFailedError" ? cause.traceId : undefined;
    const detail = relayError ? relayProtectedErrorMessage(relayError) : null;
    return new CloudEnvironmentLinkError({
      message: detail ? `${message}: ${detail}` : message,
      cause,
      ...(traceId ? { traceId } : {}),
    });
  };
}

function findEnvironmentCloudApiError(cause: unknown): { readonly message: string } | null {
  if (isEnvironmentCloudApiError(cause)) {
    return cause;
  }
  if (typeof cause !== "object" || cause === null) {
    return null;
  }
  return "cause" in cause ? findEnvironmentCloudApiError(cause.cause) : null;
}

const environmentApiError = (message: string) => (cause: unknown) => {
  const environmentError = findEnvironmentCloudApiError(cause);
  return new CloudEnvironmentLinkError({
    message: environmentError
      ? `${message.replace(/[.:]$/, "")}: ${environmentError.message}`
      : message,
    cause,
  });
};

function endpointOrigin(httpBaseUrl: string) {
  const url = new URL(httpBaseUrl);
  return {
    localHttpHost: "127.0.0.1",
    localHttpPort: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  };
}

const MANAGED_ENDPOINT_PROVIDER_KIND =
  "cloudflare_tunnel" satisfies RelayManagedEndpointProviderKind;

function ensureLinkedEnvironmentMatches(input: {
  readonly expectedEnvironmentId: string;
  readonly expectedProviderKind: RelayManagedEndpointProviderKind;
  readonly link: RelayEnvironmentLinkResponse;
}): Effect.Effect<void, CloudEnvironmentLinkError> {
  if (input.link.environmentId !== input.expectedEnvironmentId) {
    return new CloudEnvironmentLinkError({
      message: "El relay devolvió credenciales para un entorno diferente.",
    });
  }
  if (input.link.endpoint.providerKind !== input.expectedProviderKind) {
    return new CloudEnvironmentLinkError({
      message: "El relay devolvió credenciales para un proveedor de endpoint diferente.",
    });
  }
  return Effect.void;
}

export interface CloudLinkTarget {
  readonly environmentId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export type CloudLinkState = EnvironmentCloudLinkStateResult;

export function collectCloudLinkTargets(input: {
  readonly primary: CloudLinkTarget | null;
  readonly saved: ReadonlyArray<CloudLinkTarget>;
}): ReadonlyArray<CloudLinkTarget> {
  const byId = new Map<string, CloudLinkTarget>();
  if (input.primary) {
    byId.set(input.primary.environmentId, input.primary);
  }
  for (const environment of input.saved) {
    if (!byId.has(environment.environmentId)) {
      byId.set(environment.environmentId, environment);
    }
  }
  return [...byId.values()];
}

export function readPrimaryCloudLinkTarget(): CloudLinkTarget | null {
  const descriptor = readPrimaryEnvironmentDescriptor();
  const target = readPrimaryEnvironmentTarget();
  if (!descriptor || !target) {
    return null;
  }
  return {
    environmentId: descriptor.environmentId,
    label: descriptor.label,
    httpBaseUrl: target.target.httpBaseUrl,
    wsBaseUrl: target.target.wsBaseUrl,
  };
}

export function listManagedCloudEnvironments(input: {
  readonly clerkToken: string;
}): Effect.Effect<
  ReadonlyArray<RelayClientEnvironmentRecord>,
  CloudEnvironmentLinkError,
  ManagedRelay.ManagedRelayClient
> {
  return Effect.gen(function* () {
    const configuredRelayUrl = relayUrl();
    if (!configuredRelayUrl) {
      return yield* new CloudEnvironmentLinkError({
        message: "La URL del relay de Fenix Code no está configurada.",
      });
    }
    const relayClient = yield* ManagedRelay.ManagedRelayClient;
    return yield* relayClient
      .listEnvironments({
        clerkToken: input.clerkToken,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CloudEnvironmentLinkError({
              message: "No se pudieron listar los entornos gestionados por el relay.",
              cause,
            }),
        ),
      );
  });
}

export function listCloudDevices(input: {
  readonly clerkToken: string;
}): Effect.Effect<
  ReadonlyArray<RelayClientDeviceRecord>,
  CloudEnvironmentLinkError,
  ManagedRelay.ManagedRelayClient
> {
  return Effect.gen(function* () {
    if (!relayUrl()) {
      return yield* new CloudEnvironmentLinkError({
        message: "La URL del relay de Fenix Code no está configurada.",
      });
    }
    const relayClient = yield* ManagedRelay.ManagedRelayClient;
    return yield* relayClient.listDevices({ clerkToken: input.clerkToken }).pipe(
      Effect.mapError(
        (cause) =>
          new CloudEnvironmentLinkError({
            message: "No se pudieron listar los dispositivos en la nube.",
            cause,
          }),
      ),
    );
  });
}

export function readPrimaryCloudLinkState(input: {
  readonly target: CloudLinkTarget;
}): Effect.Effect<CloudLinkState | null, CloudEnvironmentLinkError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(input.target.httpBaseUrl);
    return yield* client.connect
      .linkState({ headers: {} })
      .pipe(
        Effect.mapError(
          environmentApiError("No se pudo leer el estado del enlace en la nube del entorno."),
        ),
      );
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
}

export function updatePrimaryCloudPreferences(input: {
  readonly target: CloudLinkTarget;
  readonly publishAgentActivity: boolean;
}): Effect.Effect<CloudLinkState, CloudEnvironmentLinkError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(input.target.httpBaseUrl);
    return yield* client.connect
      .preferences({
        headers: {},
        payload: input,
      })
      .pipe(
        Effect.mapError(
          environmentApiError("No se pudieron actualizar las preferencias de nube del entorno."),
        ),
      );
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
}

export function unlinkPrimaryEnvironmentFromCloud(input: {
  readonly target: CloudLinkTarget;
  readonly clerkToken: string | null;
}): Effect.Effect<
  void,
  CloudEnvironmentLinkError,
  HttpClient.HttpClient | ManagedRelay.ManagedRelayClient
> {
  return Effect.gen(function* () {
    const client = yield* makeEnvironmentHttpApiClient(input.target.httpBaseUrl);
    yield* client.connect
      .unlink({ headers: {} })
      .pipe(Effect.mapError(environmentApiError("No se pudo desvincular el entorno de la nube.")));

    const configuredRelayUrl = relayUrl();
    if (configuredRelayUrl && input.clerkToken) {
      const relayClient = yield* ManagedRelay.ManagedRelayClient;
      yield* relayClient
        .unlinkEnvironment({
          clerkToken: input.clerkToken,
          environmentId: EnvironmentId.make(input.target.environmentId),
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning(
              "No se pudo revocar el enlace remoto tras desvincular el entorno local.",
              {
                cause,
              },
            ),
          ),
        );
    }
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
}

// "publish_only" links the environment to the relay for agent-activity
// publishing alone: no managed tunnel is provisioned, so it can be toggled
// independently of Fenix Connect while clients reach the environment out of band.
export type CloudLinkMode = "managed" | "publish_only";

const PUBLISH_ONLY_PROVIDER_KIND = "manual" satisfies RelayManagedEndpointProviderKind;

export function linkPrimaryEnvironmentToCloud(input: {
  readonly target: CloudLinkTarget;
  readonly clerkToken: string;
  readonly mode?: CloudLinkMode;
}): Effect.Effect<
  void,
  CloudEnvironmentLinkError,
  EnvironmentRegistry | HttpClient.HttpClient | ManagedRelay.ManagedRelayClient
> {
  return Effect.gen(function* () {
    const configuredRelayUrl = relayUrl();
    if (!configuredRelayUrl) {
      return yield* new CloudEnvironmentLinkError({
        message: "La URL del servicio de retransmisión no está configurada.",
      });
    }
    const managedTunnelsEnabled = (input.mode ?? "managed") === "managed";
    const providerKind = managedTunnelsEnabled
      ? MANAGED_ENDPOINT_PROVIDER_KIND
      : PUBLISH_ONLY_PROVIDER_KIND;
    const relayClient = yield* ManagedRelay.ManagedRelayClient;
    const environmentClient = yield* makeEnvironmentHttpApiClient(input.target.httpBaseUrl);
    if (managedTunnelsEnabled) {
      yield* ensureRelayClientAvailable(EnvironmentId.make(input.target.environmentId));
    }

    const challenge = yield* relayClient
      .createEnvironmentLinkChallenge({
        clerkToken: input.clerkToken,
        payload: {
          notificationsEnabled: true,
          liveActivitiesEnabled: true,
          managedTunnelsEnabled,
        },
      })
      .pipe(
        Effect.mapError(
          decodedRelayClientError(
            `${configuredRelayUrl}/v1/client/environment-link-challenges failed`,
          ),
        ),
      );
    const proof = yield* environmentClient.connect
      .linkProof({
        headers: {},
        payload: {
          challenge: challenge.challenge,
          relayIssuer: configuredRelayUrl,
          endpoint: {
            httpBaseUrl: input.target.httpBaseUrl,
            wsBaseUrl: input.target.wsBaseUrl,
            providerKind,
          },
          origin: endpointOrigin(input.target.httpBaseUrl),
        },
      })
      .pipe(
        Effect.mapError(environmentApiError("No se pudo obtener la prueba de enlace del entorno.")),
      );
    const link = yield* relayClient
      .linkEnvironment({
        clerkToken: input.clerkToken,
        payload: {
          proof,
          notificationsEnabled: true,
          liveActivitiesEnabled: true,
          managedTunnelsEnabled,
        },
      })
      .pipe(
        Effect.mapError(
          decodedRelayClientError(`${configuredRelayUrl}/v1/client/environment-links failed`),
        ),
      );
    yield* ensureLinkedEnvironmentMatches({
      expectedEnvironmentId: input.target.environmentId,
      expectedProviderKind: providerKind,
      link,
    });

    yield* environmentClient.connect
      .relayConfig({
        headers: {},
        payload: {
          relayUrl: configuredRelayUrl,
          relayIssuer: link.relayIssuer,
          cloudUserId: link.cloudUserId,
          environmentCredential: link.environmentCredential,
          cloudMintPublicKey: link.cloudMintPublicKey,
          endpointRuntime: link.endpointRuntime,
        },
      })
      .pipe(
        Effect.mapError(
          environmentApiError("No se pudo configurar el acceso de retransmisión del entorno."),
        ),
      );
  }).pipe(Effect.provide(primaryEnvironmentHttpLayer));
}
