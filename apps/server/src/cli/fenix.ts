import * as NodeCrypto from "node:crypto";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import * as CliError from "effect/unstable/cli/CliError";

import {
  FENIX_COMPANION_CAPABILITIES,
  canonicalizeFenixCompanionRoot,
  normalizeFenixPortalOrigin,
  readFenixCompanionConfig,
  writeFenixCompanionConfig,
  type FenixCompanionConfig,
} from "../fenix/CompanionConfig.ts";
import { baseDirFlag, resolveCliAuthConfig } from "./config.ts";

const portalFlag = Flag.string("portal").pipe(
  Flag.withDescription("Origen del portal Fenix, por ejemplo https://iaonline.io."),
);
const attemptIdFlag = Flag.string("attempt-id").pipe(
  Flag.withDescription("Intento de emparejamiento de un solo uso emitido por el portal Fenix."),
);
const pairingTokenFlag = Flag.string("pairing-token").pipe(
  Flag.withDescription("Token de emparejamiento de un solo uso emitido por el portal Fenix."),
);
const allowRootFlag = Flag.string("allow-root").pipe(
  Flag.withDescription("Carpeta local inicial permitida (por defecto, la carpeta actual)."),
  Flag.optional,
);

function pemPublicKey(spki: ArrayBuffer): string {
  const body =
    Buffer.from(spki)
      .toString("base64")
      .match(/.{1,64}/g)
      ?.join("\n") ?? "";
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

async function consumePairing(input: {
  readonly portalOrigin: string;
  readonly attemptId: string;
  readonly pairingToken: string;
}): Promise<{
  readonly device: {
    readonly deviceId: string;
    readonly deviceName: string;
  };
  readonly deviceCredential: string;
}> {
  const keyPair = await NodeCrypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const payload = new TextEncoder().encode(
    `fenix-code-lab-pair-v1\n${input.attemptId}\n${input.pairingToken}`,
  );
  const signature = await NodeCrypto.webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    payload,
  );
  const publicKey = await NodeCrypto.webcrypto.subtle.exportKey("spki", keyPair.publicKey);
  // @effect-diagnostics-next-line globalFetch:off - this one-shot CLI exchange has no ambient Effect runtime.
  const response = await fetch(
    new URL("/api/v1/code-lab/companion/pairings/consume", input.portalOrigin),
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: input.attemptId,
        pairingToken: input.pairingToken,
        publicKeyPem: pemPublicKey(publicKey),
        proofBase64: Buffer.from(signature).toString("base64"),
        capabilities: FENIX_COMPANION_CAPABILITIES,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`El emparejamiento con Fenix fue rechazado (HTTP ${response.status}).`);
  }
  const value = (await response.json()) as Record<string, unknown>;
  const device = value.device as Record<string, unknown> | undefined;
  if (
    typeof device?.deviceId !== "string" ||
    typeof device.deviceName !== "string" ||
    typeof value.deviceCredential !== "string"
  ) {
    throw new Error("El portal Fenix devolvió credenciales con un formato no válido.");
  }
  return {
    device: { deviceId: device.deviceId, deviceName: device.deviceName },
    deviceCredential: value.deviceCredential,
  };
}

class FenixCompanionNotPairedError extends CliError.UserError {
  override get message() {
    return "Empareja este equipo antes de añadir carpetas locales.";
  }
}

class FenixCompanionCommandError extends Schema.TaggedErrorClass<FenixCompanionCommandError>()(
  "FenixCompanionCommandError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const commandFailure = (fallback: string) => (cause: unknown) =>
  new FenixCompanionCommandError({
    detail: cause instanceof Error && cause.message.length > 0 ? cause.message : fallback,
  });

const pairCommand = Command.make("pair", {
  portal: portalFlag,
  attemptId: attemptIdFlag,
  pairingToken: pairingTokenFlag,
  allowRoot: allowRootFlag,
  baseDir: baseDirFlag,
}).pipe(
  Command.withDescription("Empareja este servidor local de Fenix Code con el portal Fenix."),
  Command.withHandler((input) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig({ baseDir: input.baseDir }, logLevel);
      const portalOrigin = normalizeFenixPortalOrigin(input.portal);
      const allowedRoot = yield* Effect.tryPromise({
        try: () =>
          canonicalizeFenixCompanionRoot(Option.getOrElse(input.allowRoot, () => process.cwd())),
        catch: commandFailure("No se pudo autorizar la carpeta local inicial."),
      });
      const paired = yield* Effect.tryPromise({
        try: () =>
          consumePairing({
            portalOrigin,
            attemptId: input.attemptId,
            pairingToken: input.pairingToken,
          }),
        catch: commandFailure("Falló el emparejamiento con Fenix."),
      });
      const companion: FenixCompanionConfig = {
        version: 1,
        portalOrigin,
        deviceId: paired.device.deviceId,
        deviceName: paired.device.deviceName,
        deviceCredential: paired.deviceCredential,
        allowedRoots: [allowedRoot],
      };
      yield* Effect.tryPromise({
        try: () => writeFenixCompanionConfig(config.stateDir, companion),
        catch: commandFailure("No se pudieron guardar las credenciales de Fenix Code."),
      });
      yield* Console.log(
        `${companion.deviceName} emparejado. Carpeta local permitida: ${allowedRoot}. Reinicia Fenix Code para conectar.`,
      );
    }),
  ),
);

const statusCommand = Command.make("status", { baseDir: baseDirFlag }).pipe(
  Command.withDescription("Muestra el estado de conexión de este equipo con el portal Fenix."),
  Command.withHandler(({ baseDir }) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig({ baseDir }, logLevel);
      const companion = yield* Effect.tryPromise({
        try: () => readFenixCompanionConfig(config.stateDir),
        catch: commandFailure("No se pudo leer la configuración local de Fenix Code."),
      });
      if (companion === null) {
        yield* Console.log("Este equipo no está emparejado con el portal Fenix.");
        return;
      }
      yield* Console.log(
        [
          `Equipo: ${companion.deviceName}`,
          `Portal: ${companion.portalOrigin}`,
          "Carpetas locales permitidas:",
          ...companion.allowedRoots.map((root) => `  ${root}`),
        ].join("\n"),
      );
    }),
  ),
);

const rootAddCommand = Command.make("add", {
  root: Argument.string("root"),
  baseDir: baseDirFlag,
}).pipe(
  Command.withDescription("Autoriza una carpeta local adicional."),
  Command.withHandler(({ root, baseDir }) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const serverConfig = yield* resolveCliAuthConfig({ baseDir }, logLevel);
      const companion = yield* Effect.tryPromise({
        try: () => readFenixCompanionConfig(serverConfig.stateDir),
        catch: commandFailure("No se pudo leer la configuración local de Fenix Code."),
      });
      if (companion === null) {
        return yield* new FenixCompanionNotPairedError({ cause: "not-paired" });
      }
      const canonicalRoot = yield* Effect.tryPromise({
        try: () => canonicalizeFenixCompanionRoot(root),
        catch: commandFailure("No se pudo autorizar la carpeta local."),
      });
      yield* Effect.tryPromise({
        try: () =>
          writeFenixCompanionConfig(serverConfig.stateDir, {
            ...companion,
            allowedRoots: [...new Set([...companion.allowedRoots, canonicalRoot])],
          }),
        catch: commandFailure("No se pudo actualizar la configuración local de Fenix Code."),
      });
      yield* Console.log(`Carpeta local autorizada: ${canonicalRoot}`);
    }),
  ),
);

const rootCommand = Command.make("root").pipe(
  Command.withDescription("Gestiona las carpetas locales autorizadas para este emparejamiento."),
  Command.withSubcommands([rootAddCommand]),
);

export const fenixCommand = Command.make("fenix").pipe(
  Command.withDescription("Empareja y configura este equipo con el portal Fenix."),
  Command.withSubcommands([pairCommand, statusCommand, rootCommand]),
);
