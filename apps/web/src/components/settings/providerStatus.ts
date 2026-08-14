import type { ServerProvider, ServerProviderVersionAdvisory } from "@t3tools/contracts";

/**
 * Visual treatment for each server-reported provider status. Centralized so
 * the default-driver card and per-instance cards share the same language.
 */
export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

/**
 * Derive the headline + detail copy shown under a provider's name in the
 * settings page. Prefers `provider.message` for server-supplied detail and
 * falls back to generic phrasing when the server has not yet reported any
 * state — which happens before the first probe or when an instance names a
 * driver this build does not ship.
 */
export function getProviderSummary(provider: ServerProvider | undefined) {
  if (!provider) {
    return {
      headline: "Comprobando el estado del proveedor",
      detail: "Esperando a que el servidor informe de la instalación y la autenticación.",
    };
  }
  if (!provider.enabled) {
    return {
      headline: "Desactivado",
      detail:
        provider.message ??
        "Este proveedor está instalado, pero desactivado para sesiones nuevas en Fenix Code.",
    };
  }
  if (!provider.installed) {
    return {
      headline: "No encontrado",
      detail: provider.message ?? "No se detectó la CLI en PATH.",
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Autenticado · ${authLabel}` : "Autenticado",
      detail: provider.message ?? null,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Sin autenticar",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Requiere atención",
      detail:
        provider.message ??
        "El proveedor está instalado, pero el servidor no pudo verificarlo por completo.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "No disponible",
      detail: provider.message ?? "El proveedor no superó las comprobaciones de inicio.",
    };
  }
  return {
    headline: "Disponible",
    detail: provider.message ?? "Instalado y listo, pero no se pudo verificar la autenticación.",
  };
}

/**
 * Normalize a version string for display. Adds the `v` prefix when the
 * driver reported a bare version (e.g. `1.2.3`) so cards render
 * consistently regardless of driver.
 */
export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
): {
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
} | null {
  if (!advisory || advisory.status === "current" || advisory.status === "unknown") {
    return null;
  }

  const label = "Actualización disponible";
  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    detail:
      advisory.message ??
      (versionLabel
        ? `${label}: install ${versionLabel}.`
        : `${label}: install the latest provider version.`),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
  };
}
