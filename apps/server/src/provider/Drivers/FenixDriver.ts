import { FenixSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeFenixTextGeneration } from "../../textGeneration/FenixTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeFenixAdapter } from "../Layers/FenixAdapter.ts";
import { buildInitialFenixProviderSnapshot } from "../Layers/FenixProvider.ts";
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
import * as FenixPairingSessionBridge from "../Services/FenixPairingSessionBridge.ts";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);

const DRIVER_KIND = ProviderDriverKind.make("fenix");
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName: null,
  }),
);

export type FenixDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | FenixPairingSessionBridge.FenixPairingSessionBridge
  | FileSystem.FileSystem
  | Path.Path
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
      const effectiveConfig = { ...config, enabled } satisfies FenixSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: "",
        env: process.env,
      });

      const adapter = yield* makeFenixAdapter(effectiveConfig, {
        instanceId,
        pairingSession: () =>
          Effect.gen(function* () {
            const nowEpochMs = yield* Clock.currentTimeMillis;
            const snapshot = yield* pairingSessionBridge.resolvePairingSessionSnapshot({
              instanceId,
            });
            return FenixPairingSessionBridge.activePairingSessionFromSnapshot(snapshot, nowEpochMs);
          }),
      });
      const textGeneration = yield* makeFenixTextGeneration;

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<FenixSettings>>({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialFenixProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: buildInitialFenixProviderSnapshot(effectiveConfig).pipe(
          Effect.map(stampIdentity),
        ),
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
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
