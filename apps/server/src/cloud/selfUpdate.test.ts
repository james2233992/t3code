import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as ServerConfig from "../config.ts";
import * as ServerSelfUpdate from "./selfUpdate.ts";

const makeHarness = Effect.fn("test.make_self_update_harness")(function* (mode: "web" | "desktop") {
  const fs = yield* FileSystem.FileSystem;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "fenix-self-update-test-" });
  const config = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
  return yield* ServerSelfUpdate.make().pipe(
    Effect.provide(ServerConfig.layer({ ...config, mode })),
  );
});

it.layer(NodeServices.layer)("server self update", (it) => {
  it.effect("does not advertise an upstream package update for a background service", () =>
    Effect.sync(() => {
      expect(
        ServerSelfUpdate.resolveServerSelfUpdateCapability({
          desktopManaged: false,
          launcherManaged: true,
        }),
      ).toBeNull();
    }),
  );

  it.effect("fails closed before attempting a remote package update", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const selfUpdate = yield* makeHarness("web");
        const error = yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);

        expect(error.reason).toContain("upstream package is not a trusted Fenix runtime");
      }),
    ),
  );

  it.effect("keeps desktop updates delegated to the desktop app", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const selfUpdate = yield* makeHarness("desktop");
        const error = yield* selfUpdate.update({ targetVersion: "1.1.0" }).pipe(Effect.flip);

        expect(error.reason).toContain("desktop app");
      }),
    ),
  );
});
