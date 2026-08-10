import { CustomCliSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeCustomCliTextGeneration } from "../../textGeneration/CustomCliTextGeneration.ts";
import { makeCustomCliAdapter } from "../Layers/CustomCliAdapter.ts";
import { buildInitialCustomCliProviderSnapshot } from "../Layers/CustomCliProvider.ts";
import { CUSTOM_CLI_DRIVER_KIND } from "../Layers/CustomCliPolicy.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

const decodeCustomCliSettings = Schema.decodeSync(CustomCliSettings);
const DRIVER_KIND: ProviderDriverKind = CUSTOM_CLI_DRIVER_KIND;
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type CustomCliDriverEnv = ChildProcessSpawner.ChildProcessSpawner;

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

export const CustomCliDriver: ProviderDriver<CustomCliSettings, CustomCliDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Custom CLI",
    supportsMultipleInstances: true,
  },
  configSchema: CustomCliSettings,
  defaultConfig: (): CustomCliSettings => decodeCustomCliSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const processEnv = mergeProviderInstanceEnvironment(environment);
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
      const effectiveConfig = { ...config, enabled } satisfies CustomCliSettings;
      const adapter = yield* makeCustomCliAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
      });
      const textGeneration = yield* makeCustomCliTextGeneration();
      const initialSnapshot = yield* buildInitialCustomCliProviderSnapshot(effectiveConfig).pipe(
        Effect.map(stampIdentity),
      );
      const snapshot = {
        maintenanceCapabilities: MAINTENANCE_CAPABILITIES,
        getSnapshot: Effect.succeed(initialSnapshot),
        refresh: Effect.succeed(initialSnapshot),
        streamChanges: Stream.empty,
      };

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
