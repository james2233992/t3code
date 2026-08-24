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
export const FENIX_FALLBACK_MODEL = "groq/openai/gpt-oss-120b";

export interface FenixCodeModelCatalogProvider {
  readonly providerSlug: string;
  readonly displayName: string;
  readonly models: ReadonlyArray<string>;
  readonly isDefault: boolean;
}

export interface FenixCodeModelCatalog {
  readonly canSelectModels: boolean;
  readonly providers: ReadonlyArray<FenixCodeModelCatalogProvider>;
}

export interface FenixModelEntitlement {
  readonly session: FenixPairingSession;
  readonly modelCatalog: FenixCodeModelCatalog;
}

export type FenixModelEntitlementResolver = () => Effect.Effect<
  FenixModelEntitlement | null | undefined
>;

export interface FenixAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly fetch?: typeof fetch;
  readonly pairingEntitlement?: FenixModelEntitlement | FenixModelEntitlementResolver;
  readonly pairingSession?: FenixPairingSession | FenixPairingSessionResolver;
  readonly runtimeDirectory?: string;
}

export type FenixPairingSession =
  | { readonly kind: "cookie"; readonly authToken: string }
  | { readonly kind: "bearer"; readonly token: string };

export type FenixPairingSessionResolver = () => Effect.Effect<
  FenixPairingSession | null | undefined
>;

const FALLBACK_CATALOG: FenixCodeModelCatalog = {
  canSelectModels: false,
  providers: [
    {
      providerSlug: "groq",
      displayName: "Groq",
      models: ["openai/gpt-oss-120b"],
      isDefault: true,
    },
  ],
};

const CLEAN_SLUG = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

export function fallbackFenixCodeModelCatalog(): FenixCodeModelCatalog {
  return FALLBACK_CATALOG;
}

export function isCanonicalFenixModel(model: string): boolean {
  return model === FENIX_FALLBACK_MODEL || (model.startsWith("openai/") && CLEAN_SLUG.test(model));
}

function isCleanDisplayName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function normalizeFenixCodeModelCatalog(payload: unknown): FenixCodeModelCatalog {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return FALLBACK_CATALOG;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.canSelectModels !== "boolean" || !Array.isArray(record.providers)) {
    return FALLBACK_CATALOG;
  }

  const parsedProviders: FenixCodeModelCatalogProvider[] = [];
  for (const candidate of record.providers) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return FALLBACK_CATALOG;
    }
    const provider = candidate as Record<string, unknown>;
    if (
      typeof provider.providerSlug !== "string" ||
      !CLEAN_SLUG.test(provider.providerSlug) ||
      provider.providerSlug.includes("/") ||
      !isCleanDisplayName(provider.displayName) ||
      !Array.isArray(provider.models) ||
      typeof provider.isDefault !== "boolean" ||
      provider.models.some((model) => typeof model !== "string" || !CLEAN_SLUG.test(model))
    ) {
      return FALLBACK_CATALOG;
    }
    parsedProviders.push({
      providerSlug: provider.providerSlug,
      displayName: provider.displayName,
      models: provider.models as ReadonlyArray<string>,
      isDefault: provider.isDefault,
    });
  }

  if (!record.canSelectModels) return FALLBACK_CATALOG;

  const seen = new Set<string>();
  const providers: FenixCodeModelCatalogProvider[] = [];
  for (const provider of parsedProviders) {
    const models = provider.models.filter((model) => {
      const canonical = `${provider.providerSlug}/${model}`;
      if (!isCanonicalFenixModel(canonical) || seen.has(canonical)) return false;
      seen.add(canonical);
      return true;
    });
    if (models.length > 0) providers.push({ ...provider, models });
  }

  const hasSelectableOpenAi = providers.some(
    (provider) => provider.providerSlug === "openai" && provider.models.length > 0,
  );
  if (!hasSelectableOpenAi) return FALLBACK_CATALOG;

  return { canSelectModels: true, providers };
}

export interface FenixCatalogModel {
  readonly canonical: string;
  readonly displayName: string;
  readonly isDefault: boolean;
}

export function listFenixCatalogModels(
  catalog: FenixCodeModelCatalog,
): ReadonlyArray<FenixCatalogModel> {
  const normalized = normalizeFenixCodeModelCatalog(catalog);
  return normalized.providers.flatMap((provider) =>
    provider.models.map((model, index) => ({
      canonical: `${provider.providerSlug}/${model}`,
      displayName: `${provider.displayName} ${model}`,
      isDefault: provider.isDefault && index === 0,
    })),
  );
}

function defaultFenixModel(catalog: FenixCodeModelCatalog): string {
  const models = listFenixCatalogModels(catalog);
  return models.find((model) => model.isDefault)?.canonical ?? FENIX_FALLBACK_MODEL;
}

function toInternalModel(canonical: string): string {
  return `fenix/${canonical}`;
}

function fromInternalModel(model: string | null | undefined): string | null {
  if (!model?.startsWith("fenix/")) return null;
  const canonical = model.slice("fenix/".length);
  return isCanonicalFenixModel(canonical) ? canonical : null;
}

export function wrapFenixOpenCodeAdapter(input: {
  readonly settings: FenixSettings;
  readonly instanceId: ProviderInstanceId;
  readonly delegate: ProviderAdapterShape<ProviderAdapterError>;
  readonly initialCatalog?: FenixCodeModelCatalog;
  readonly resolveEntitlement?: FenixModelEntitlementResolver;
}): FenixAdapterShape {
  const { instanceId: boundInstanceId, delegate } = input;
  const runtimeCatalog = normalizeFenixCodeModelCatalog(input.initialCatalog ?? FALLBACK_CATALOG);
  const runtimeCatalogSignature = JSON.stringify(runtimeCatalog);
  const threadModels = new Map<string, string>();
  const resolveEntitlement =
    input.resolveEntitlement ??
    (() =>
      Effect.succeed({
        session: { kind: "bearer", token: "adapter-test-entitlement" },
        modelCatalog: runtimeCatalog,
      }));

  const requireCurrentEntitlement = (operation: string) =>
    readModelEntitlement(resolveEntitlement).pipe(
      Effect.flatMap((entitlement) =>
        !entitlement
          ? Effect.fail(
              new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation,
                issue: "Fenix pairing is not active.",
              }),
            )
          : JSON.stringify(entitlement.modelCatalog) !== runtimeCatalogSignature
            ? Effect.fail(
                new ProviderAdapterValidationError({
                  provider: PROVIDER,
                  operation,
                  issue:
                    "Fenix pairing model catalog changed after the OpenCode runtime started. Restart Fenix Code before using the refreshed catalog.",
                }),
              )
            : Effect.succeed(entitlement),
      ),
    );

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
      const entitlement = yield* requireCurrentEntitlement("startSession");
      const selectedModel = yield* requireExternalModel(
        entitlement.modelCatalog,
        sessionInput.modelSelection?.model,
      );
      const session = yield* delegate.startSession({
        ...sessionInput,
        modelSelection: {
          ...sessionInput.modelSelection,
          instanceId: boundInstanceId,
          model: toInternalModel(selectedModel),
        },
      });
      threadModels.set(sessionInput.threadId, selectedModel);
      return toExternalSession(session, selectedModel);
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
      const entitlement = yield* requireCurrentEntitlement("sendTurn");
      const selectedModel = yield* requireExternalModel(
        entitlement.modelCatalog,
        turnInput.modelSelection?.model ?? threadModels.get(turnInput.threadId),
      );
      const previousModel = threadModels.get(turnInput.threadId);
      threadModels.set(turnInput.threadId, selectedModel);
      return yield* delegate
        .sendTurn({
          ...turnInput,
          modelSelection: {
            ...turnInput.modelSelection,
            instanceId: boundInstanceId,
            model: toInternalModel(selectedModel),
          },
        })
        .pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              if (previousModel) threadModels.set(turnInput.threadId, previousModel);
              else threadModels.delete(turnInput.threadId);
            }),
          ),
        );
    });

  return {
    provider: PROVIDER,
    capabilities: delegate.capabilities,
    startSession,
    sendTurn,
    interruptTurn: delegate.interruptTurn,
    respondToRequest: delegate.respondToRequest,
    respondToUserInput: delegate.respondToUserInput,
    stopSession: (threadId) =>
      delegate
        .stopSession(threadId)
        .pipe(Effect.tap(() => Effect.sync(() => threadModels.delete(threadId)))),
    listSessions: () =>
      delegate.listSessions().pipe(
        Effect.map((sessions) =>
          sessions.map((session) => {
            const model = fromInternalModel(session.model) ?? threadModels.get(session.threadId);
            if (model) threadModels.set(session.threadId, model);
            return toExternalSession(session, model);
          }),
        ),
      ),
    hasSession: delegate.hasSession,
    readThread: delegate.readThread,
    rollbackThread: delegate.rollbackThread,
    stopAll: () =>
      delegate.stopAll().pipe(Effect.tap(() => Effect.sync(() => threadModels.clear()))),
    streamEvents: delegate.streamEvents.pipe(
      Stream.map((event) =>
        toExternalEvent(event, boundInstanceId, threadModels.get(event.threadId)),
      ),
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

function readModelEntitlement(
  input: FenixModelEntitlement | FenixModelEntitlementResolver | undefined,
): Effect.Effect<FenixModelEntitlement | null> {
  return (typeof input === "function" ? input() : Effect.succeed(input)).pipe(
    Effect.map((entitlement) => {
      if (!entitlement) return null;
      const session = validatePairingSession(entitlement.session);
      if (!session) return null;
      return {
        session,
        modelCatalog: normalizeFenixCodeModelCatalog(entitlement.modelCatalog),
      };
    }),
    Effect.catchCause(() => Effect.succeed(null)),
  );
}

function requireExternalModel(
  catalog: FenixCodeModelCatalog,
  model: string | null | undefined,
): Effect.Effect<string, ProviderAdapterValidationError> {
  const selected = model ?? defaultFenixModel(catalog);
  const allowedModels = new Set(listFenixCatalogModels(catalog).map((entry) => entry.canonical));
  return isCanonicalFenixModel(selected) && allowedModels.has(selected)
    ? Effect.succeed(selected)
    : Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "modelSelection",
          issue: `Fenix model '${selected}' is not available in the active pairing catalog.`,
        }),
      );
}

function toExternalSession(session: ProviderSession, selectedModel?: string): ProviderSession {
  const model = fromInternalModel(session.model) ?? selectedModel;
  return { ...session, provider: PROVIDER, ...(model ? { model } : {}) };
}

function toExternalEvent(
  event: ProviderRuntimeEvent,
  instanceId: ProviderInstanceId,
  threadModel?: string,
): ProviderRuntimeEvent {
  const eventModel = event.type === "turn.started" ? fromInternalModel(event.payload.model) : null;
  const payload =
    event.type === "turn.started"
      ? {
          ...event.payload,
          ...((eventModel ?? threadModel) ? { model: eventModel ?? threadModel } : {}),
        }
      : event.payload;
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

export function buildFenixOpenCodeConfig(
  baseUrl: string,
  apiKey: string,
  catalog: FenixCodeModelCatalog = FALLBACK_CATALOG,
): string {
  const models = listFenixCatalogModels(catalog);
  const defaultModel = defaultFenixModel(catalog);
  return JSON.stringify({
    model: toInternalModel(defaultModel),
    small_model: toInternalModel(defaultModel),
    enabled_providers: ["fenix"],
    autoupdate: false,
    share: "disabled",
    plugin: [],
    mcp: {},
    provider: {
      fenix: {
        npm: "@ai-sdk/openai-compatible",
        name: "Fenix Code",
        options: { baseURL: baseUrl, apiKey },
        models: Object.fromEntries(
          models.map((model) => [
            model.canonical,
            {
              name: model.displayName,
              limit: { context: 131_072, output: 8_192 },
            },
          ]),
        ),
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
    const resolvePairingEntitlement = () =>
      options?.pairingEntitlement
        ? readModelEntitlement(options.pairingEntitlement)
        : readPairingSession(options?.pairingSession).pipe(
            Effect.map((session) => (session ? { session, modelCatalog: FALLBACK_CATALOG } : null)),
          );
    const initialEntitlement = yield* resolvePairingEntitlement();
    const initialCatalog = initialEntitlement?.modelCatalog ?? FALLBACK_CATALOG;
    const resolvePairingSession = () =>
      resolvePairingEntitlement().pipe(Effect.map((entitlement) => entitlement?.session ?? null));
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
        buildFenixOpenCodeConfig(loopbackProxy.baseUrl, loopbackProxy.apiKey, initialCatalog),
      ),
      pure: true,
      allowMcpSession: false,
    });

    return wrapFenixOpenCodeAdapter({
      settings,
      instanceId: boundInstanceId,
      delegate,
      initialCatalog,
      resolveEntitlement: resolvePairingEntitlement,
    });
  });
}
