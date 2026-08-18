import {
  type FenixSettings,
  type OpenCodeSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

// @effect-diagnostics nodeBuiltinImport:off -- builds an isolated local runtime path.
import * as NodePath from "node:path";

import { type ProviderAdapterError, ProviderAdapterValidationError } from "../Errors.ts";
import { makeFenixOpenAiLoopbackProxy } from "../FenixOpenAiLoopbackProxy.ts";
import type { FenixAdapterShape } from "../Services/FenixAdapter.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makeOpenCodeAdapter } from "./OpenCodeAdapter.ts";

const PROVIDER = ProviderDriverKind.make("fenix");
const EXTERNAL_MODEL = "groq/openai/gpt-oss-120b";
const INTERNAL_MODEL = "fenix/openai/gpt-oss-120b";

export interface FenixAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly fetch?: typeof fetch;
  readonly pairingSession?: FenixPairingSession | FenixPairingSessionResolver;
  readonly runtimeDirectory?: string;
}

export type FenixPairingSession =
  | { readonly kind: "cookie"; readonly authToken: string }
  | { readonly kind: "bearer"; readonly token: string };

export type FenixPairingSessionResolver = () => Effect.Effect<
  FenixPairingSession | null | undefined
>;

export function wrapFenixOpenCodeAdapter(input: {
  readonly settings: FenixSettings;
  readonly instanceId: ProviderInstanceId;
  readonly delegate: ProviderAdapterShape<ProviderAdapterError>;
}): FenixAdapterShape {
  const { settings, instanceId: boundInstanceId, delegate } = input;

  const startSession: FenixAdapterShape["startSession"] = (sessionInput) =>
    Effect.gen(function* () {
      if (
        sessionInput.modelSelection &&
        sessionInput.modelSelection.instanceId !== boundInstanceId
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Fenix model selection is bound to instance '${boundInstanceId}'.`,
        });
      }
      yield* requireExternalModel(sessionInput.modelSelection?.model ?? settings.featuredModel);
      const session = yield* delegate.startSession({
        ...sessionInput,
        modelSelection: {
          ...sessionInput.modelSelection,
          instanceId: boundInstanceId,
          model: INTERNAL_MODEL,
        },
      });
      return toExternalSession(session);
    });

  const sendTurn: FenixAdapterShape["sendTurn"] = (turnInput) =>
    Effect.gen(function* () {
      if (turnInput.modelSelection && turnInput.modelSelection.instanceId !== boundInstanceId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: `Fenix model selection is bound to instance '${boundInstanceId}'.`,
        });
      }
      yield* requireExternalModel(turnInput.modelSelection?.model);
      return yield* delegate.sendTurn({
        ...turnInput,
        modelSelection: {
          ...turnInput.modelSelection,
          instanceId: boundInstanceId,
          model: INTERNAL_MODEL,
        },
      });
    });

  return {
    provider: PROVIDER,
    capabilities: delegate.capabilities,
    startSession,
    sendTurn,
    interruptTurn: delegate.interruptTurn,
    respondToRequest: delegate.respondToRequest,
    respondToUserInput: delegate.respondToUserInput,
    stopSession: delegate.stopSession,
    listSessions: () =>
      delegate.listSessions().pipe(Effect.map((sessions) => sessions.map(toExternalSession))),
    hasSession: delegate.hasSession,
    readThread: delegate.readThread,
    rollbackThread: delegate.rollbackThread,
    stopAll: delegate.stopAll,
    streamEvents: delegate.streamEvents.pipe(
      Stream.map((event) => toExternalEvent(event, boundInstanceId)),
    ),
  } satisfies FenixAdapterShape;
}

function hasInvalidHeaderValue(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127 || char.trim().length === 0) return true;
  }
  return false;
}

function validatePairingSession(
  session: FenixPairingSession | null | undefined,
): FenixPairingSession | null {
  if (!session) return null;
  if (session.kind === "cookie") {
    return session.authToken.length > 0 &&
      !hasInvalidHeaderValue(session.authToken) &&
      !session.authToken.includes(";") &&
      !session.authToken.includes(",")
      ? { kind: session.kind, authToken: session.authToken }
      : null;
  }
  return session.token.length > 0 && !hasInvalidHeaderValue(session.token)
    ? { kind: session.kind, token: session.token }
    : null;
}

function readPairingSession(
  input: FenixPairingSession | FenixPairingSessionResolver | undefined,
): Effect.Effect<FenixPairingSession | null> {
  return (typeof input === "function" ? input() : Effect.succeed(input)).pipe(
    Effect.map(validatePairingSession),
  );
}

function requireExternalModel(
  model: string | null | undefined,
): Effect.Effect<string, ProviderAdapterValidationError> {
  const selected = model?.trim() || EXTERNAL_MODEL;
  return selected === EXTERNAL_MODEL
    ? Effect.succeed(selected)
    : Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "modelSelection",
          issue: `Fenix is restricted to '${EXTERNAL_MODEL}'.`,
        }),
      );
}

function toExternalSession(session: ProviderSession): ProviderSession {
  return { ...session, provider: PROVIDER, model: EXTERNAL_MODEL };
}

function toExternalEvent(
  event: ProviderRuntimeEvent,
  instanceId: ProviderInstanceId,
): ProviderRuntimeEvent {
  const payload =
    event.type === "turn.started" ? { ...event.payload, model: EXTERNAL_MODEL } : event.payload;
  return {
    ...event,
    provider: PROVIDER,
    providerInstanceId: instanceId,
    payload,
  } as ProviderRuntimeEvent;
}

function resolveOpenCodeBinary(): string {
  return (
    process.env.FENIX_CODE_OPENCODE_BINARY?.trim() ||
    process.env.OPENCODE_BINARY?.trim() ||
    "opencode"
  );
}

export function buildFenixOpenCodeConfig(baseUrl: string, apiKey: string): string {
  return JSON.stringify({
    model: INTERNAL_MODEL,
    small_model: INTERNAL_MODEL,
    enabled_providers: ["fenix"],
    autoupdate: false,
    share: "disabled",
    plugin: [],
    mcp: {},
    provider: {
      fenix: {
        npm: "@ai-sdk/openai-compatible",
        name: "Fenix Agent 9 Groq",
        options: { baseURL: baseUrl, apiKey },
        models: {
          "openai/gpt-oss-120b": {
            name: "Agent 9 Groq",
            limit: { context: 131_072, output: 8_192 },
          },
        },
      },
    },
  });
}

export function buildIsolatedFenixOpenCodeEnvironment(
  runtimeDirectory: string,
  configContent: string,
): NodeJS.ProcessEnv {
  const root = NodePath.resolve(runtimeDirectory);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: NodePath.join(root, "config"),
    XDG_DATA_HOME: NodePath.join(root, "data"),
    XDG_STATE_HOME: NodePath.join(root, "state"),
    XDG_CACHE_HOME: NodePath.join(root, "cache"),
    OPENCODE_CONFIG_DIR: NodePath.join(root, "config", "opencode"),
    OPENCODE_CONFIG_CONTENT: configContent,
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_AUTO_SHARE: "false",
  };
  delete environment.OPENCODE_CONFIG;
  delete environment.OPENCODE_PERMISSION;
  return environment;
}

export function makeFenixAdapter(settings: FenixSettings, options?: FenixAdapterLiveOptions) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("fenix");
    const runtimeDirectory = options?.runtimeDirectory?.trim();
    if (!runtimeDirectory || !NodePath.isAbsolute(runtimeDirectory)) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "runtimeDirectory",
        issue: "Fenix requires an absolute isolated OpenCode runtime directory.",
      });
    }
    const resolvePairingSession = () => readPairingSession(options?.pairingSession);
    const loopbackProxy = yield* makeFenixOpenAiLoopbackProxy({
      pairingSession: resolvePairingSession,
      ...(options?.fetch ? { fetch: options.fetch } : {}),
    });
    const openCodeSettings: OpenCodeSettings = {
      enabled: settings.enabled,
      binaryPath: resolveOpenCodeBinary(),
      serverUrl: "",
      serverPassword: "",
      customModels: [],
    };
    const delegate = yield* makeOpenCodeAdapter(openCodeSettings, {
      instanceId: boundInstanceId,
      environment: buildIsolatedFenixOpenCodeEnvironment(
        runtimeDirectory,
        buildFenixOpenCodeConfig(loopbackProxy.baseUrl, loopbackProxy.apiKey),
      ),
      pure: true,
      allowMcpSession: false,
    });

    return wrapFenixOpenCodeAdapter({
      settings,
      instanceId: boundInstanceId,
      delegate,
    });
  });
}
