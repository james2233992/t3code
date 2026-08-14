import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { describe, expect, it } from "vite-plus/test";

import { presentSavedCloudEnvironmentConnection } from "./cloudEnvironmentConnectionPresentation";

function connection(
  phase: EnvironmentConnectionPresentation["phase"],
  error: string | null = null,
): EnvironmentConnectionPresentation {
  return { phase, error, traceId: null };
}

describe("saved cloud environment connection presentation", () => {
  it("only labels a live connection as connected", () => {
    expect(presentSavedCloudEnvironmentConnection(connection("connected"))).toEqual({
      buttonLabel: "Conectado",
      statusText: "Conectado",
      tone: "connected",
    });

    expect(presentSavedCloudEnvironmentConnection(connection("connecting"))).toEqual({
      buttonLabel: "Conectando…",
      statusText: "Conectando...",
      tone: "connecting",
    });
  });

  it("surfaces a failed attempt while the supervisor reconnects", () => {
    expect(
      presentSavedCloudEnvironmentConnection(
        connection("reconnecting", "Relay environment endpoint is unavailable."),
      ),
    ).toEqual({
      buttonLabel: "Reconectando…",
      statusText:
        "No se pudo conectar. Reconectando... Motivo: Relay environment endpoint is unavailable.",
      tone: "connecting",
    });
  });

  it.each([
    ["error", "Falló la conexión", "Falló la conexión. Motivo: Access denied.", "error"],
    ["offline", "Sin conexión", "Sin conexión", "idle"],
    ["available", "No conectado", "Disponible", "idle"],
  ] as const)(
    "presents %s without claiming the environment is connected",
    (phase, buttonLabel, statusText, tone) => {
      expect(
        presentSavedCloudEnvironmentConnection(
          connection(phase, phase === "error" ? "Access denied." : null),
        ),
      ).toEqual({ buttonLabel, statusText, tone });
    },
  );
});
