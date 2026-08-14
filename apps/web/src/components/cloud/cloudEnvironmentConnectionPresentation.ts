import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";

export interface SavedCloudEnvironmentConnectionPresentation {
  readonly buttonLabel: string;
  readonly statusText: string;
  readonly tone: "connected" | "connecting" | "error" | "idle";
}

/**
 * Present the live supervisor state for an environment that is already in the
 * connection catalog. Catalog membership only means the environment is saved;
 * it does not mean the connection attempt succeeded.
 */
export function presentSavedCloudEnvironmentConnection(
  connection: EnvironmentConnectionPresentation,
): SavedCloudEnvironmentConnectionPresentation {
  switch (connection.phase) {
    case "connected":
      return {
        buttonLabel: "Conectado",
        statusText: "Conectado",
        tone: "connected",
      };
    case "connecting":
      return {
        buttonLabel: "Conectando…",
        statusText: "Conectando...",
        tone: "connecting",
      };
    case "reconnecting":
      return {
        buttonLabel: "Reconectando…",
        statusText: connection.error
          ? `No se pudo conectar. Reconectando... Motivo: ${connection.error}`
          : "No se pudo conectar. Reconectando...",
        tone: "connecting",
      };
    case "error":
      return {
        buttonLabel: "Falló la conexión",
        statusText: connection.error
          ? `Falló la conexión. Motivo: ${connection.error}`
          : "Falló la conexión",
        tone: "error",
      };
    case "offline":
      return {
        buttonLabel: "Sin conexión",
        statusText: "Sin conexión",
        tone: "idle",
      };
    case "available":
      return {
        buttonLabel: "No conectado",
        statusText: "Disponible",
        tone: "idle",
      };
  }
}
