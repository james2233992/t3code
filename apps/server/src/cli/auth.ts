import {
  AuthAdministrativeScopes,
  AuthSessionId,
  AuthStandardClientScopes,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";

import {
  formatIssuedPairingCredential,
  formatIssuedSession,
  formatPairingCredentialList,
  formatSessionList,
} from "../cliAuthFormat.ts";
import * as ServerConfig from "../config.ts";
import {
  authLocationFlags,
  type CliAuthLocationFlags,
  DurationFromString,
  resolveCliAuthConfig,
} from "./config.ts";

const runWithEnvironmentAuth = <A, E>(
  flags: CliAuthLocationFlags,
  run: (environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"]) => Effect.Effect<A, E>,
  options?: {
    readonly quietLogs?: boolean;
  },
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const minimumLogLevel = options?.quietLogs ? "Error" : config.logLevel;
    return yield* Effect.gen(function* () {
      const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
      return yield* run(environmentAuth);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(EnvironmentAuth.runtimeLayer).pipe(
          Layer.provide(ServerConfig.layer(config)),
          Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
        ),
      ),
    );
  });

const ttlFlag = Flag.string("ttl").pipe(
  Flag.withSchema(DurationFromString),
  Flag.withDescription("Duración, por ejemplo `5m`, `1h`, `30d` o `15 minutes`."),
  Flag.optional,
);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Devuelve JSON en lugar de texto legible."),
  Flag.withDefault(false),
);

const labelFlag = Flag.string("label").pipe(
  Flag.withDescription("Etiqueta descriptiva opcional."),
  Flag.optional,
);

const subjectFlag = Flag.string("subject").pipe(
  Flag.withDescription("Sujeto opcional del token de sesión."),
  Flag.optional,
);

const baseUrlFlag = Flag.string("base-url").pipe(
  Flag.withDescription("URL pública opcional para generar un enlace `/pair#token=...` listo."),
  Flag.optional,
);

const tokenOnlyFlag = Flag.boolean("token-only").pipe(
  Flag.withDescription("Muestra solo el token de acceso emitido."),
  Flag.withDefault(false),
);

const pairingCreateCommand = Command.make("create", {
  ...authLocationFlags,
  ttl: ttlFlag,
  label: labelFlag,
  baseUrl: baseUrlFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Emite un nuevo token de emparejamiento para un cliente."),
  Command.withHandler((flags) =>
    runWithEnvironmentAuth(
      flags,
      (environmentAuth) =>
        Effect.gen(function* () {
          const issued = yield* environmentAuth.createPairingLink({
            scopes: AuthStandardClientScopes,
            subject: "one-time-token",
            ...(Option.isSome(flags.ttl) ? { ttl: flags.ttl.value } : {}),
            ...(Option.isSome(flags.label) ? { label: flags.label.value } : {}),
          });
          const output = formatIssuedPairingCredential(issued, {
            json: flags.json,
            ...(Option.isSome(flags.baseUrl) ? { baseUrl: flags.baseUrl.value } : {}),
          });
          yield* Console.log(output);
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const pairingListCommand = Command.make("list", {
  ...authLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Lista los emparejamientos activos sin revelar sus secretos."),
  Command.withHandler((flags) =>
    runWithEnvironmentAuth(
      flags,
      (environmentAuth) =>
        Effect.gen(function* () {
          const pairingLinks = yield* environmentAuth.listPairingLinks({
            excludeSubjects: [EnvironmentAuth.INTERNAL_ADMINISTRATIVE_BOOTSTRAP_SUBJECT],
          });
          yield* Console.log(formatPairingCredentialList(pairingLinks, { json: flags.json }));
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const pairingRevokeCommand = Command.make("revoke", {
  ...authLocationFlags,
  id: Argument.string("id").pipe(
    Argument.withDescription("ID del emparejamiento que se revocará."),
  ),
}).pipe(
  Command.withDescription("Revoca un token de emparejamiento activo."),
  Command.withHandler((flags) =>
    runWithEnvironmentAuth(flags, (environmentAuth) =>
      Effect.gen(function* () {
        const revoked = yield* environmentAuth.revokePairingLink(flags.id);
        yield* Console.log(
          revoked
            ? `Emparejamiento ${flags.id} revocado.\n`
            : `No se encontró un emparejamiento activo para ${flags.id}.\n`,
        );
      }),
    ),
  ),
);

const pairingCommand = Command.make("pairing").pipe(
  Command.withDescription("Gestiona tokens de emparejamiento de un solo uso."),
  Command.withSubcommands([pairingCreateCommand, pairingListCommand, pairingRevokeCommand]),
);

const sessionIssueCommand = Command.make("issue", {
  ...authLocationFlags,
  ttl: ttlFlag,
  label: labelFlag,
  subject: subjectFlag,
  tokenOnly: tokenOnlyFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Emite un token de acceso limitado para clientes remotos o sin interfaz.",
  ),
  Command.withHandler((flags) =>
    runWithEnvironmentAuth(
      flags,
      (environmentAuth) =>
        Effect.gen(function* () {
          const issued = yield* environmentAuth.issueSession({
            scopes: AuthAdministrativeScopes,
            ...(Option.isSome(flags.ttl) ? { ttl: flags.ttl.value } : {}),
            ...(Option.isSome(flags.label) ? { label: flags.label.value } : {}),
            ...(Option.isSome(flags.subject) ? { subject: flags.subject.value } : {}),
          });
          yield* Console.log(
            formatIssuedSession(issued, {
              json: flags.json,
              tokenOnly: flags.tokenOnly,
            }),
          );
        }),
      {
        quietLogs: flags.json || flags.tokenOnly,
      },
    ),
  ),
);

const sessionListCommand = Command.make("list", {
  ...authLocationFlags,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Lista las sesiones activas sin revelar sus tokens."),
  Command.withHandler((flags) =>
    runWithEnvironmentAuth(
      flags,
      (environmentAuth) =>
        Effect.gen(function* () {
          const sessions = yield* environmentAuth.listSessions();
          yield* Console.log(formatSessionList(sessions, { json: flags.json }));
        }),
      {
        quietLogs: flags.json,
      },
    ),
  ),
);

const sessionRevokeCommand = Command.make("revoke", {
  ...authLocationFlags,
  sessionId: Argument.string("session-id").pipe(
    Argument.withDescription("ID de la sesión que se revocará."),
    Argument.withSchema(AuthSessionId),
  ),
}).pipe(
  Command.withDescription("Revoca una sesión activa."),
  Command.withHandler((flags) =>
    runWithEnvironmentAuth(flags, (environmentAuth) =>
      Effect.gen(function* () {
        const revoked = yield* environmentAuth.revokeSession(flags.sessionId);
        yield* Console.log(
          revoked
            ? `Sesión ${flags.sessionId} revocada.\n`
            : `No se encontró una sesión activa para ${flags.sessionId}.\n`,
        );
      }),
    ),
  ),
);

const sessionCommand = Command.make("session").pipe(
  Command.withDescription("Gestiona las sesiones de acceso."),
  Command.withSubcommands([sessionIssueCommand, sessionListCommand, sessionRevokeCommand]),
);

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Gestiona la autenticación local para instalaciones sin interfaz."),
  Command.withSubcommands([pairingCommand, sessionCommand]),
);
