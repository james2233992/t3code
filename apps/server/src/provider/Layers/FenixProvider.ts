import {
  type FenixSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { createModelCapabilities, normalizeModelSlug } from "@t3tools/shared/model";

import {
  buildServerProvider,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const FENIX_PRESENTATION = {
  displayName: "Fenix",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});
const PROVIDER = ProviderDriverKind.make("fenix");

export const FENIX_FEATURED_CODING_MODEL = "groq/openai/gpt-oss-120b";

export const FENIX_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: FENIX_FEATURED_CODING_MODEL,
    name: "Agente Groq de Programacion",
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  },
];

export function fenixModelsFromSettings(
  settings: Pick<FenixSettings, "customModels" | "featuredModel">,
): ReadonlyArray<ServerProviderModel> {
  const featured =
    normalizeModelSlug(settings.featuredModel, PROVIDER) ?? FENIX_FEATURED_CODING_MODEL;
  const builtIns =
    featured === FENIX_FEATURED_CODING_MODEL
      ? FENIX_BUILT_IN_MODELS
      : [
          {
            slug: featured,
            name: featured,
            isCustom: false,
            capabilities: EMPTY_CAPABILITIES,
          },
          ...FENIX_BUILT_IN_MODELS,
        ];
  return providerModelsFromSettings(builtIns, settings.customModels, EMPTY_CAPABILITIES);
}

export function buildInitialFenixProviderSnapshot(
  fenixSettings: FenixSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = fenixModelsFromSettings(fenixSettings);

    if (!fenixSettings.enabled) {
      return buildServerProvider({
        presentation: FENIX_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Fenix driver is disabled until Code Lab pairing QA is complete.",
        },
      });
    }

    return buildServerProvider({
      presentation: FENIX_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Fenix driver is waiting for a paired Fenix session.",
      },
    });
  });
}
