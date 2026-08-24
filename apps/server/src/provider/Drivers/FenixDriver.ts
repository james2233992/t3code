import { FenixSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeFenixTextGeneration } from "../../textGeneration/FenixTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeFenixAdapter } from "../Layers/FenixAdapter.ts";
import {
  buildInitialFenixProviderSnapshot,
  FENIX_BUILT_IN_MODELS,
} from "../Layers/FenixProvider.ts";
import {
  fallbackFenixCodeModelCatalog,
  listFenixCatalogModels,
  type FenixCodeModelCatalog,
} from "../Layers/FenixAdapter.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeStaticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { OpenCodeRuntime } from "../opencodeRuntime.ts";
import * as FenixPairingSessionBridge from "../Services/FenixPairingSessionBridge.ts";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);

const DRIVER_KIND = ProviderDriverKind.make("fenix");
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName: null,
  }),
);

export function applyFenixModelCatalogToSnapshot(
  snapshot: ServerProviderDraft,
  catalog: FenixCodeModelCatalog,
): ServerProviderDraft {
  const capabilities = FENIX_BUILT_IN_MODELS[0]!.capabilities;
  return {
    ...snapshot,
    models: listFenixCatalogModels(catalog).map((model) => ({
      slug: model.canonical,
      name: model.displayName,
      isCustom: false,
      isDefault: model.isDefault,
      capabilities,
    })),
  };
}

export function resolveFenixDriverEnabled(
  configuredEnabled: boolean,
  requirePortalAuth = process.env.FENIX_CODE_REQUIRE_PORTAL_AUTH,
): boolean {
  return configuredEnabled || requirePortalAuth === "1";
}

export type FenixDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | Crypto.Crypto
  | FenixPairingSessionBridge.FenixPairingSessionBridge
  | FileSystem.FileSystem
  | OpenCodeRuntime
  | Path.Path
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const FenixDriver: ProviderDriver<FenixSettings, FenixDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Fenix",
    supportsMultipleInstances: true,
  },
  configSchema: FenixSettings,
  defaultConfig: (): FenixSettings => decodeFenixSettings({}),
  create: ({ instanceId, displayName, accentColor, enabled, config }) =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const path = yield* Path.Path;
      const pairingSessionBridge = yield* FenixPairingSessionBridge.FenixPairingSessionBridge;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveEnabled = resolveFenixDriverEnabled(enabled);
      const effectiveConfig = { ...config, enabled: effectiveEnabled } satisfies FenixSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: "",
        env: process.env,
      });

      const resolveActivePairingSnapshot = () =>
        Effect.gen(function* () {
          const nowEpochMs = yield* Clock.currentTimeMillis;
          const snapshot = yield* pairingSessionBridge.resolvePairingSessionSnapshot({
            instanceId,
          });
          return FenixPairingSessionBridge.activePairingEnvelopeFromSnapshot(snapshot, nowEpochMs);
        });
      const buildProviderSnapshot = (settings: FenixSettings) =>
        Effect.gen(function* () {
          const [baseSnapshot, pairingSnapshot] = yield* Effect.all([
            buildInitialFenixProviderSnapshot(settings),
            resolveActivePairingSnapshot(),
          ]);
          return applyFenixModelCatalogToSnapshot(
            baseSnapshot,
            pairingSnapshot?.modelCatalog ?? fallbackFenixCodeModelCatalog(),
          );
        });

      const adapter = yield* makeFenixAdapter(effectiveConfig, {
        instanceId,
        runtimeDirectory: path.join(serverConfig.baseDir, "runtime", "opencode-fenix"),
        pairingEntitlement: () =>
          resolveActivePairingSnapshot().pipe(
            Effect.map((snapshot) =>
              snapshot ? { session: snapshot.session, modelCatalog: snapshot.modelCatalog } : null,
            ),
          ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to start the isolated Fenix execution runtime: ${cause.message}`,
              cause,
            }),
        ),
      );
      const textGeneration = yield* makeFenixTextGeneration;

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<FenixSettings>>({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: buildProviderSnapshot(effectiveConfig).pipe(Effect.map(stampIdentity)),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Fenix snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled: effectiveEnabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
