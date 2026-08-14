import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Terminal from "effect/Terminal";
import { Command, GlobalFlag, Prompt } from "effect/unstable/cli";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../cloud/bootService.ts";
import type * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

export const bootServiceLayer = (config: ServerConfig.ServerConfig["Service"]) =>
  BootService.layer({
    baseDir: config.baseDir,
    logsDir: config.logsDir,
    cliVersion: packageJson.version,
  }).pipe(Layer.provide(ProcessRunner.layer));

export type ServiceReconcileResult =
  | {
      readonly changed: false;
      readonly status: BootService.BootServiceStatus;
    }
  | {
      readonly changed: true;
      readonly previouslyInstalled: boolean;
      readonly plan: BootService.BootServicePlan;
    };

/** Install, update, or repair the service using the CLI version running this command. */
export const reconcileService = Effect.fn("cli.service.reconcile")(function* () {
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  if (status.installed && status.current) {
    return { changed: false, status } satisfies ServiceReconcileResult;
  }
  const plan = yield* service.install;
  return {
    changed: true,
    previouslyInstalled: status.installed,
    plan,
  } satisfies ServiceReconcileResult;
});

export function formatServiceStatus(
  status: BootService.BootServiceStatus,
  cliVersion: string,
): string {
  if (!status.supported) {
    return "Servicio Fenix Code\n  Estado: no disponible en este equipo\n  Compatible con: Linux con systemd o macOS con launchd";
  }
  if (!status.installed) {
    return "Servicio Fenix Code\n  Estado: no instalado\n  Siguiente paso: ejecuta `fenix-code service install`.";
  }
  return [
    "Servicio Fenix Code",
    `  Estado: ${status.current ? `instalado · Fenix Code v${cliVersion}` : "necesita actualización o reparación"}`,
    `  Unidad: ${status.unitPath}`,
    `  Registros: ${status.logPath}`,
    ...(status.current ? [] : ["  Siguiente paso: ejecuta `fenix-code service update`."]),
  ].join("\n");
}

const runServiceCommand = Effect.fn("cli.service.run")(function* <A, E>(
  flags: { readonly baseDir: Parameters<typeof resolveCliAuthConfig>[0]["baseDir"] },
  run: Effect.Effect<A, E, BootService.BootService>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* run.pipe(Effect.provide(bootServiceLayer(config)));
});

const serviceInstallCommand = Command.make("install", projectLocationFlags).pipe(
  Command.withDescription("Instala Fenix Code como servicio en segundo plano para este usuario."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const result = yield* reconcileService();
        if (!result.changed) {
          yield* Console.log(
            `El servicio Fenix Code ya está instalado con Fenix Code v${packageJson.version}.`,
          );
          return;
        }
        yield* Console.log(
          `Servicio Fenix Code v${packageJson.version} ${result.previouslyInstalled ? "actualizado" : "instalado"}.\nRegistros: ${result.plan.logPath}`,
        );
      }),
    ),
  ),
);

const serviceUpdateCommand = Command.make("update", projectLocationFlags).pipe(
  Command.withDescription("Actualiza o repara el servicio Fenix Code con esta versión."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const result = yield* reconcileService();
        if (!result.changed) {
          yield* Console.log(`El servicio Fenix Code ya usa Fenix Code v${packageJson.version}.`);
          return;
        }
        yield* Console.log(
          `Servicio Fenix Code v${packageJson.version} ${result.previouslyInstalled ? "actualizado" : "instalado"}.\nRegistros: ${result.plan.logPath}`,
        );
      }),
    ),
  ),
);

const serviceUninstallCommand = Command.make("uninstall", projectLocationFlags).pipe(
  Command.withDescription("Detiene y elimina el servicio Fenix Code."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        const removed = yield* service.uninstall;
        yield* Console.log(
          removed ? "Servicio Fenix Code eliminado." : "El servicio Fenix Code no está instalado.",
        );
      }),
    ),
  ),
);

const serviceStatusCommand = Command.make("status", projectLocationFlags).pipe(
  Command.withDescription("Muestra el estado de instalación del servicio Fenix Code."),
  Command.withHandler((flags) =>
    runServiceCommand(
      flags,
      Effect.gen(function* () {
        const service = yield* BootService.BootService;
        yield* Console.log(formatServiceStatus(yield* service.status, packageJson.version));
      }),
    ),
  ),
);

export const offerServiceDuringOnboarding = Effect.gen(function* () {
  const service = yield* BootService.BootService;
  const { supported, installed, current } = yield* service.status;
  if (!supported) {
    return false;
  }
  if (installed && current) {
    yield* Console.log("Fenix Code ya está configurado para ejecutarse en segundo plano.");
    return true;
  }
  const wanted = yield* Prompt.run(
    Prompt.confirm({
      message: installed
        ? "El servicio Fenix Code necesita una actualización o reparación. ¿Actualizarlo ahora?"
        : "¿Iniciar Fenix Code en segundo plano al arrancar este equipo? " +
          "Seguirá disponible mediante Fenix Connect aunque cierres sesión.",
      initial: true,
    }),
  );
  if (!wanted) {
    return false;
  }
  const result = yield* reconcileService();
  if (result.changed) {
    yield* Console.log(
      `Servicio en segundo plano ${result.previouslyInstalled ? "actualizado" : "instalado"}. Registros: ${result.plan.logPath}`,
    );
  }
  return true;
});

export const recoverServiceOnboardingOffer = <R>(
  offer: Effect.Effect<boolean, BootService.BootServiceError | Terminal.QuitError, R>,
) =>
  offer.pipe(
    Effect.catchTags({
      QuitError: () => Effect.succeed(false),
      BootServiceUnsupportedError: (error) =>
        Console.log(`Se omite la configuración en segundo plano: ${error.message}`).pipe(
          Effect.as(false),
        ),
      BootServiceCommandError: (error) =>
        Console.warn(`No terminó la configuración en segundo plano: ${error.message}`).pipe(
          Effect.as(false),
        ),
      BootServiceInstallError: (error) =>
        Console.warn(`No terminó la configuración en segundo plano: ${error.message}`).pipe(
          Effect.as(false),
        ),
      BootServiceUpdatePendingError: (error) =>
        Console.warn(`No terminó la configuración en segundo plano: ${error.message}`).pipe(
          Effect.as(false),
        ),
    }),
  );

export const serviceCommand = Command.make("service").pipe(
  Command.withDescription("Gestiona el servicio Fenix Code en segundo plano."),
  Command.withSubcommands([
    serviceInstallCommand,
    serviceUninstallCommand,
    serviceUpdateCommand,
    serviceStatusCommand,
  ]),
);
