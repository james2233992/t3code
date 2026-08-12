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
  Flag.withDescription("Fenix portal origin, for example https://iaonline.io."),
);
const attemptIdFlag = Flag.string("attempt-id").pipe(
  Flag.withDescription("One-time pairing attempt issued by the Fenix portal."),
);
const pairingTokenFlag = Flag.string("pairing-token").pipe(
  Flag.withDescription("One-time pairing token issued by the Fenix portal."),
);
const allowRootFlag = Flag.string("allow-root").pipe(
  Flag.withDescription("Initial local workspace root (defaults to the current directory)."),
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
    throw new Error(`Fenix pairing was rejected (HTTP ${response.status}).`);
  }
  const value = (await response.json()) as Record<string, unknown>;
  const device = value.device as Record<string, unknown> | undefined;
  if (
    typeof device?.deviceId !== "string" ||
    typeof device.deviceName !== "string" ||
    typeof value.deviceCredential !== "string"
  ) {
    throw new Error("Fenix pairing returned a malformed credential envelope.");
  }
  return {
    device: { deviceId: device.deviceId, deviceName: device.deviceName },
    deviceCredential: value.deviceCredential,
  };
}

class FenixCompanionNotPairedError extends CliError.UserError {
  override get message() {
    return "Pair this machine before adding local roots.";
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
  Command.withDescription("Pair this local Fenix Code server with the Fenix portal."),
  Command.withHandler((input) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig({ baseDir: input.baseDir }, logLevel);
      const portalOrigin = normalizeFenixPortalOrigin(input.portal);
      const allowedRoot = yield* Effect.tryPromise({
        try: () =>
          canonicalizeFenixCompanionRoot(Option.getOrElse(input.allowRoot, () => process.cwd())),
        catch: commandFailure("The initial local root could not be authorized."),
      });
      const paired = yield* Effect.tryPromise({
        try: () =>
          consumePairing({
            portalOrigin,
            attemptId: input.attemptId,
            pairingToken: input.pairingToken,
          }),
        catch: commandFailure("Fenix pairing failed."),
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
        catch: commandFailure("The Fenix companion credential could not be stored."),
      });
      yield* Console.log(
        `Paired ${companion.deviceName}. Local root allowed: ${allowedRoot}. Restart Fenix Code to connect.`,
      );
    }),
  ),
);

const statusCommand = Command.make("status", { baseDir: baseDirFlag }).pipe(
  Command.withDescription("Show the local Fenix portal companion status."),
  Command.withHandler(({ baseDir }) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig({ baseDir }, logLevel);
      const companion = yield* Effect.tryPromise({
        try: () => readFenixCompanionConfig(config.stateDir),
        catch: commandFailure("The Fenix companion configuration could not be read."),
      });
      if (companion === null) {
        yield* Console.log("This machine is not paired with the Fenix portal.");
        return;
      }
      yield* Console.log(
        [
          `Device: ${companion.deviceName}`,
          `Portal: ${companion.portalOrigin}`,
          "Allowed local roots:",
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
  Command.withDescription("Authorize one additional local workspace root."),
  Command.withHandler(({ root, baseDir }) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const serverConfig = yield* resolveCliAuthConfig({ baseDir }, logLevel);
      const companion = yield* Effect.tryPromise({
        try: () => readFenixCompanionConfig(serverConfig.stateDir),
        catch: commandFailure("The Fenix companion configuration could not be read."),
      });
      if (companion === null) {
        return yield* new FenixCompanionNotPairedError({ cause: "not-paired" });
      }
      const canonicalRoot = yield* Effect.tryPromise({
        try: () => canonicalizeFenixCompanionRoot(root),
        catch: commandFailure("The local root could not be authorized."),
      });
      yield* Effect.tryPromise({
        try: () =>
          writeFenixCompanionConfig(serverConfig.stateDir, {
            ...companion,
            allowedRoots: [...new Set([...companion.allowedRoots, canonicalRoot])],
          }),
        catch: commandFailure("The Fenix companion configuration could not be updated."),
      });
      yield* Console.log(`Authorized local root: ${canonicalRoot}`);
    }),
  ),
);

const rootCommand = Command.make("root").pipe(
  Command.withDescription("Manage local workspace roots exposed to this pairing."),
  Command.withSubcommands([rootAddCommand]),
);

export const fenixCommand = Command.make("fenix").pipe(
  Command.withDescription("Pair and configure the Fenix portal companion."),
  Command.withSubcommands([pairCommand, statusCommand, rootCommand]),
);
