import type { LocalApi } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { type MouseEvent, useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readLocalApi } from "../localApi";

export class PullRequestLinkOpenError extends Schema.TaggedErrorClass<PullRequestLinkOpenError>()(
  "PullRequestLinkOpenError",
  {
    targetOrigin: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  static fromCause(targetUrl: string, cause: unknown): PullRequestLinkOpenError {
    let targetOrigin: string | null = null;
    try {
      targetOrigin = new URL(targetUrl).origin;
    } catch {
      // Keep malformed URLs out of diagnostics while preserving the open failure below.
    }
    return new PullRequestLinkOpenError({ targetOrigin, cause });
  }

  override get message(): string {
    return this.targetOrigin === null
      ? "No se pudo abrir el enlace de la solicitud de cambios."
      : `No se pudo abrir el enlace de la solicitud de cambios en ${this.targetOrigin}.`;
  }
}

export async function openPullRequestLink(
  shell: Pick<LocalApi["shell"], "openExternal">,
  targetUrl: string,
): Promise<void> {
  try {
    await shell.openExternal(targetUrl);
  } catch (cause) {
    throw PullRequestLinkOpenError.fromCause(targetUrl, cause);
  }
}

/**
 * Returns a click handler that opens a pull request URL in the system browser.
 *
 * Stops event propagation/default so activating the link does not also trigger
 * an enclosing row or trigger (e.g. opening the branch dropdown), and surfaces a
 * toast when the local API is unavailable or the open fails.
 */
export function useOpenPrLink() {
  return useCallback((event: MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "No se puede abrir el enlace.",
      });
      return;
    }

    void openPullRequestLink(api.shell, prUrl).catch((error) => {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "No se pudo abrir el enlace de la solicitud de cambios",
          description: error instanceof Error ? error.message : "Se ha producido un error.",
        }),
      );
    });
  }, []);
}
