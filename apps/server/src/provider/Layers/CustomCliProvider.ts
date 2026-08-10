import {
  type CustomCliSettings,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  buildServerProvider,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { validateCustomCliTemplate } from "./CustomCliPolicy.ts";

const CUSTOM_CLI_PRESENTATION = {
  displayName: "Custom CLI",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export function customCliModelsFromSettings(
  settings: Pick<CustomCliSettings, "customModels" | "modelSlug" | "name">,
): ReadonlyArray<ServerProviderModel> {
  const modelSlug = settings.modelSlug.trim() || "custom-cli/local";
  const name = settings.name.trim() || "Custom CLI";
  return providerModelsFromSettings(
    [
      {
        slug: modelSlug,
        name,
        isCustom: false,
        capabilities: EMPTY_CAPABILITIES,
      },
    ],
    settings.customModels,
    EMPTY_CAPABILITIES,
  );
}

export function buildInitialCustomCliProviderSnapshot(
  settings: CustomCliSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = customCliModelsFromSettings(settings);
    const validation = validateCustomCliTemplate(settings);

    if (!settings.enabled) {
      return buildServerProvider({
        presentation: CUSTOM_CLI_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Custom CLI agents are disabled until a local template explicitly enables them.",
        },
      });
    }

    if (!validation.ok) {
      return buildServerProvider({
        presentation: CUSTOM_CLI_PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: validation.issue ?? "Invalid custom CLI template.",
        },
      });
    }

    return buildServerProvider({
      presentation: CUSTOM_CLI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "unknown", type: "local-cli", label: "Local template" },
        message: "Custom CLI agent template is locally configured.",
      },
    });
  });
}
