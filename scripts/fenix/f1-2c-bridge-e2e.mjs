#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { FenixSettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makeFenixAdapter } from "../../apps/server/src/provider/Layers/FenixAdapter.ts";
import {
  activePairingSessionFromSnapshot,
  resolvePairingSessionSnapshotFromHttp,
} from "../../apps/server/src/provider/Services/FenixPairingSessionBridge.ts";

const OWNER_RELAY_TOKEN = "GO_CANDIDATO_C";
const FENIX_AUDIENCE = "https://iaonline.io";
const CHAT_MODELS_PATH = "/api/v1/ChatModels/SendMessageWithOptions";
const DEFAULT_MODEL = "groq/openai/gpt-oss-120b";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{16,64}$/;
const MONOREPO_ENV = "FENIX_MONOREPO_ROOT";

const decodeFenixSettings = Schema.decodeSync(FenixSettings);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const repoRoot = NodePath.resolve(new URL("../..", import.meta.url).pathname);
const transcript = [];

function usage() {
  return [
    "Usage: FENIX_MONOREPO_ROOT=/path/to/Fenix-future-IAM node scripts/fenix/f1-2c-bridge-e2e.mjs",
    "",
    "Runs the F1.2c local bridge E2E under owner-relay token GO_CANDIDATO_C.",
    "No production endpoints or real providers are called.",
  ].join("\n");
}

function maskSecret(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sanitizeHeaders(headers = {}) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization") {
      output[key] = "Bearer ***";
    } else if (lower === "cookie") {
      output[key] = "AuthToken=***";
    } else {
      output[key] = value;
    }
  }
  return output;
}

function sanitizeJson(value) {
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|credential|secret|authorization|cookie/i.test(key)) {
      output[key] = typeof item === "string" ? maskSecret(item) : item;
    } else {
      output[key] = sanitizeJson(item);
    }
  }
  return output;
}

function record(step, data) {
  transcript.push({ step, ...sanitizeJson(data) });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function allocatePort() {
  return await new Promise((resolvePort, reject) => {
    const server = NodeNet.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePort(address.port);
        else reject(new Error("Failed to allocate a loopback port."));
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/__e2e/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
  }
  throw new Error(`Timed out waiting for local monorepo API: ${lastError}`);
}

function dotnetHarnessSource(port) {
  return String.raw`
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using AIWork_API.Services.ChatModels;
using AIWork_API.Services.CodeLab;
using Microsoft.Extensions.Options;

var owner = new CodeLabOwnerContext(17, 29, 41);
var clock = new MutableTimeProvider(DateTimeOffset.UtcNow);
var controlPlane = new InMemoryCodeLabControlPlane(
    Options.Create(new CodeLabControlPlaneOptions
    {
        Enabled = true,
        AllowedCompanyIds = new[] { owner.CompanyId },
        AllowedUserIds = Array.Empty<int>(),
        AllowedAgentIds = new[] { owner.AgentId },
        PairingTokenTtlSeconds = 300,
        WebSocketTicketTtlSeconds = 30,
        FenixCredentialTtlSeconds = 60,
        MaxPendingPairingsPerUser = 2,
        MaxDevicesPerUser = 4,
        MaxRememberedRevokedDevicesPerUser = 4
    }),
    clock);
var rateLimiter = new InMemoryFenixCodeChatModelsRateLimiter(TimeProvider.System);
var state = new HarnessState();

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:${port}");
builder.Logging.ClearProviders();
var app = builder.Build();

app.MapGet("/__e2e/health", () => Results.Json(new { status = "ok" }));

app.MapGet("/__e2e/stats", () => Results.Json(new
{
    state.Pairings,
    state.FenixCredentialIssues,
    state.ChatRequests,
    state.ServiceCalls,
    state.OwnerMismatchRevocations
}));

app.MapPost("/__e2e/mode", async (HttpContext context) =>
{
    var request = await JsonSerializer.DeserializeAsync<ModeRequest>(
        context.Request.Body,
        new JsonSerializerOptions(JsonSerializerDefaults.Web));
    state.OwnerMismatch = request?.OwnerMismatch == true;
    return Results.Json(new { ownerMismatch = state.OwnerMismatch });
});

app.MapPost("/__e2e/pair-device", () =>
{
    var issued = controlPlane.IssuePairing(owner, "Fenix Code E2E");
    if (!issued.Succeeded || issued.Value == null)
        return Results.Json(new { error = issued.Code }, statusCode: 500);

    using var signingKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    var proof = signingKey.SignData(
        CodeLabPairingProtocol.BuildProofPayload(issued.Value.AttemptId, issued.Value.PairingToken),
        HashAlgorithmName.SHA256);
    var consumeRequest = new CodeLabPairingConsumeRequest(
        issued.Value.AttemptId,
        issued.Value.PairingToken,
        signingKey.ExportSubjectPublicKeyInfoPem(),
        Convert.ToBase64String(proof),
        new[] { "local_runner", "fenix_code" });
    var consumed = controlPlane.ConsumePairing(consumeRequest, owner);
    if (!consumed.Succeeded || consumed.Value == null)
        return Results.Json(new { error = consumed.Code }, statusCode: 500);

    state.Pairings++;
    return Results.Json(new
    {
        device = new
        {
            consumed.Value.Device.DeviceId,
            consumed.Value.Device.DeviceName,
            consumed.Value.Device.DeviceFingerprint,
            consumed.Value.Device.TunnelId
        },
        consumed.Value.DeviceCredential,
        owner = new { owner.CompanyId, owner.UserId, owner.AgentId }
    });
});

app.MapPost("/api/v1/code-lab/companion/devices/{deviceId}/fenix-credential",
    async (string deviceId, HttpContext context) =>
{
    using var document = await JsonDocument.ParseAsync(context.Request.Body);
    var root = document.RootElement;
    if (!root.TryGetProperty("deviceCredential", out var credentialElement)
        || !root.TryGetProperty("audience", out var audienceElement))
        return Results.Json(new { error = "code_lab_device_unavailable" }, statusCode: 404);
    var deviceCredential = credentialElement.GetString() ?? string.Empty;
    var audience = audienceElement.GetString() ?? string.Empty;

    var authenticated = controlPlane.AuthenticateDevice(deviceId, deviceCredential);
    if (!authenticated.Succeeded || authenticated.Value == null)
        return Results.Json(new { error = "code_lab_device_unavailable" }, statusCode: 404);

    if (state.OwnerMismatch)
    {
        controlPlane.RevokeDevice(authenticated.Value, deviceId);
        state.OwnerMismatchRevocations++;
        return Results.Json(new { error = "code_lab_device_unavailable" }, statusCode: 404);
    }

    var result = controlPlane.IssueFenixCredential(
        authenticated.Value,
        deviceId,
        deviceCredential,
        audience);
    if (!result.Succeeded || result.Value == null)
        return Results.Json(new { error = "code_lab_device_unavailable" }, statusCode: 404);

    state.FenixCredentialIssues++;
    return Results.Json(new
    {
        kind = "bearer",
        accessToken = result.Value.AccessToken,
        expiresAt = result.Value.ExpiresAt,
        audience = result.Value.Audience,
        scopes = result.Value.Scopes,
        owner = new
        {
            result.Value.Owner.CompanyId,
            result.Value.Owner.UserId,
            result.Value.Owner.AgentId
        },
        device = new
        {
            result.Value.DeviceId,
            result.Value.TunnelId,
            fingerprint = result.Value.DeviceFingerprint
        }
    });
});

app.MapPost("/api/v1/ChatModels/SendMessageWithOptions", async (HttpContext context) =>
{
    state.ChatRequests++;
    var token = ReadBearer(context.Request.Headers.Authorization.ToString());
    if (token == null)
        return Results.Json(new { error = "unauthorized" }, statusCode: 401);

    var inspected = controlPlane.InspectFenixCredential(
        token,
        InMemoryCodeLabControlPlane.FenixAudience,
        InMemoryCodeLabControlPlane.FenixGenericChatModelsScope);
    if (!inspected.Succeeded || inspected.Value == null)
        return Results.Json(new { error = "unauthorized" }, statusCode: 401);

    var request = await JsonSerializer.DeserializeAsync<FenixCodeSendMessageRequest>(
        context.Request.Body,
        new JsonSerializerOptions(JsonSerializerDefaults.Web));
    var validation = ValidateRequest(request, inspected.Value.Owner.AgentId);
    if (validation != null)
        return StableError(400, request?.RequestId, request?.TurnId,
            FenixCodeChatModelsErrorCodes.InvalidRequest, validation);

    var parsed = ParseProviderModel(request!.Model!);
    if (parsed == null)
        return StableError(400, request.RequestId, request.TurnId,
            FenixCodeChatModelsErrorCodes.InvalidRequest,
            "Model must be in provider/model form.");

    var limit = rateLimiter.TryAcquire(new FenixCodeChatModelsRateLimitKey(
        inspected.Value.Owner.CompanyId,
        inspected.Value.Owner.UserId,
        inspected.Value.DeviceId,
        parsed.Value.Provider));
    if (!limit.Allowed)
        return StableError(429, request.RequestId, request.TurnId,
            limit.Code ?? FenixCodeChatModelsErrorCodes.RateLimitExceeded,
            limit.Message ?? "Too many Fenix Code requests for this device.");

    if (!string.Equals(parsed.Value.Provider, "groq", StringComparison.OrdinalIgnoreCase)
        || !string.Equals(parsed.Value.Model, "openai/gpt-oss-120b", StringComparison.OrdinalIgnoreCase))
        return StableError(400, request.RequestId, request.TurnId,
            FenixCodeChatModelsErrorCodes.ModelUnavailable,
            "The selected model is not available.");

    state.ServiceCalls++;
    return Results.Json(FenixCodeSendMessageResponse.Success(
        string.IsNullOrWhiteSpace(request.RequestId) ? request.TurnId!.Trim() : request.RequestId.Trim(),
        request.TurnId!.Trim(),
        "Respuesta fake Fenix Code local"));
});

await app.RunAsync();

static string? ReadBearer(string raw)
{
    const string prefix = "Bearer ";
    return raw.StartsWith(prefix, StringComparison.Ordinal) ? raw[prefix.Length..] : null;
}

static IResult StableError(int statusCode, string? requestId, string? turnId, string code, string message)
{
    var normalizedRequestId = string.IsNullOrWhiteSpace(requestId)
        ? string.IsNullOrWhiteSpace(turnId) ? string.Empty : turnId.Trim()
        : requestId.Trim();
    return Results.Json(
        FenixCodeSendMessageResponse.Failure(
            normalizedRequestId,
            string.IsNullOrWhiteSpace(turnId) ? string.Empty : turnId.Trim(),
            code,
            message),
        statusCode: statusCode);
}

static string? ValidateRequest(FenixCodeSendMessageRequest? request, int agentId)
{
    if (request == null) return "Request body is required.";
    if (!ValidText(request.Message, FenixCodeChatModelsContract.MaxMessageLength)) return "Message is required.";
    if (!ValidText(request.Model, FenixCodeChatModelsContract.MaxModelLength)) return "Model is required.";
    if (request.IsGenericChatLane != true) return "isGenericChatLane must be true.";
    if (!string.Equals(request.Source, FenixCodeChatModelsContract.Source, StringComparison.Ordinal)) return "Source must be fenix-code.";
    if (!ValidStableId(request.ThreadId, FenixCodeChatModelsContract.MaxThreadIdLength)) return "ThreadId is invalid.";
    if (!ValidStableId(request.TurnId, FenixCodeChatModelsContract.MaxTurnIdLength)) return "TurnId is invalid.";
    if (request.RequestId != null && !ValidStableId(request.RequestId, FenixCodeChatModelsContract.MaxRequestIdLength)) return "RequestId is invalid.";
    if (request.AgentId.HasValue && request.AgentId.Value != agentId) return "Agent binding does not match the credential.";
    return null;
}

static bool ValidText(string? value, int maxLength) =>
    !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= maxLength;

static bool ValidStableId(string? value, int maxLength)
{
    if (string.IsNullOrWhiteSpace(value)) return false;
    var trimmed = value.Trim();
    if (trimmed.Length != value.Length || trimmed.Length > maxLength) return false;
    return trimmed.All(c => char.IsAsciiLetterOrDigit(c) || c == '.' || c == '_' || c == ':' || c == '-');
}

static (string Provider, string Model)? ParseProviderModel(string rawModel)
{
    var trimmed = rawModel.Trim();
    var separator = trimmed.IndexOf('/');
    if (separator <= 0 || separator == trimmed.Length - 1) return null;
    var provider = trimmed[..separator];
    var model = trimmed[(separator + 1)..];
    return string.IsNullOrWhiteSpace(provider) || string.IsNullOrWhiteSpace(model)
        ? null
        : (provider, model);
}

sealed record ModeRequest(bool OwnerMismatch);

sealed record FenixCodeSendMessageRequest(
    string? Message,
    string? Model,
    bool? IsGenericChatLane,
    string? Source,
    string? ThreadId,
    string? TurnId,
    string? RequestId,
    int? AgentId);

sealed record FenixCodeSendMessageResponse(
    string Version,
    string RequestId,
    string TurnId,
    string Status,
    string? Response,
    string? ErrorCode,
    string? Message)
{
    public static FenixCodeSendMessageResponse Success(string requestId, string turnId, string response) =>
        new(FenixCodeChatModelsContract.Version, requestId, turnId, "ok", response, null, null);

    public static FenixCodeSendMessageResponse Failure(string requestId, string turnId, string errorCode, string message) =>
        new(FenixCodeChatModelsContract.Version, requestId, turnId, "error", null, errorCode, message);
}

sealed class HarnessState
{
    public bool OwnerMismatch { get; set; }
    public int Pairings { get; set; }
    public int FenixCredentialIssues { get; set; }
    public int ChatRequests { get; set; }
    public int ServiceCalls { get; set; }
    public int OwnerMismatchRevocations { get; set; }
}

sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
{
    private DateTimeOffset _now = now;
    public override DateTimeOffset GetUtcNow() => _now;
}
`;
}

async function createHarnessProject(root, port) {
  const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fenix-code-f1-2c-e2e-"));
  const projectFile = NodePath.join(tempDir, "FenixCodeBridgeE2E.csproj");
  const codeLabControlPlane = NodePath.join(
    root,
    "AIworks_2024_Net",
    "AIWork_API",
    "Services",
    "CodeLab",
    "CodeLabControlPlane.cs",
  );
  const codeLabOptions = NodePath.join(
    root,
    "AIworks_2024_Net",
    "AIWork_API",
    "Services",
    "CodeLab",
    "CodeLabControlPlaneOptions.cs",
  );
  const fenixChatModels = NodePath.join(
    root,
    "AIworks_2024_Net",
    "AIWork_API",
    "Services",
    "ChatModels",
    "FenixCodeChatModelsService.cs",
  );
  await NodeFSP.writeFile(
    projectFile,
    `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RollForward>LatestMajor</RollForward>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="${codeLabControlPlane.replaceAll("&", "&amp;")}" Link="Monorepo/CodeLabControlPlane.cs" />
    <Compile Include="${codeLabOptions.replaceAll("&", "&amp;")}" Link="Monorepo/CodeLabControlPlaneOptions.cs" />
    <Compile Include="${fenixChatModels.replaceAll("&", "&amp;")}" Link="Monorepo/FenixCodeChatModelsService.cs" />
  </ItemGroup>
</Project>
`,
  );
  await NodeFSP.writeFile(
    NodePath.join(tempDir, "ChatModelSelection.cs"),
    `namespace AIWork_API.Services.ChatModels;\npublic sealed record ChatModelSelection(string ProviderSlug, string Model, string HubProviderKey);\n`,
  );
  await NodeFSP.writeFile(NodePath.join(tempDir, "Program.cs"), dotnetHarnessSource(port));
  return { tempDir, projectFile };
}

function spawnDotnet(projectFile) {
  const child = NodeChildProcess.spawn("dotnet", ["run", "--project", projectFile], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: "Testing",
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_NOLOGO: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { child, readOutput: () => output };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return false;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return false;
    }
  }
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 1000));
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  return true;
}

async function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  record(options.step ?? path, {
    request: {
      method: options.method ?? "POST",
      path,
      headers: sanitizeHeaders(options.headers ?? {}),
      body: options.body,
    },
    response: {
      status: response.status,
      body: payload,
    },
  });
  return { response, payload };
}

function makeBridgeResolver(baseUrl, deviceId, credentialFile, nowEpochMs = () => Date.now()) {
  return () =>
    resolvePairingSessionSnapshotFromHttp({
      baseUrl,
      deviceId,
      deviceCredentialFile: credentialFile,
      nowEpochMs,
    }).pipe(Effect.map((snapshot) => activePairingSessionFromSnapshot(snapshot, nowEpochMs())));
}

function makeSettings() {
  return decodeFenixSettings({
    enabled: true,
    baseUrl: FENIX_AUDIENCE,
    chatModelsPath: "/api/v1/ChatModels",
    sendMessagePath: CHAT_MODELS_PATH,
    featuredModel: DEFAULT_MODEL,
    customModels: [],
  });
}

function makeLocalBackendFetch(apiBaseUrl, calls) {
  return async (url, init) => {
    const requestUrl = new URL(String(url));
    assert(
      requestUrl.origin === FENIX_AUDIENCE,
      `Fenix adapter attempted to send credentials to unexpected origin ${requestUrl.origin}`,
    );
    const localUrl = `${apiBaseUrl}${requestUrl.pathname}${requestUrl.search}`;
    const body = init?.body ? decodeUnknownJson(String(init.body)) : undefined;
    const response = await fetch(localUrl, init);
    const cloned = response.clone();
    const responseBody = await cloned.json().catch(async () => cloned.text().catch(() => ""));
    const entry = {
      trustedUrl: requestUrl.toString(),
      loopbackUrl: localUrl,
      request: {
        method: init?.method ?? "GET",
        headers: sanitizeHeaders(init?.headers ?? {}),
        body,
      },
      response: {
        status: response.status,
        body: responseBody,
      },
    };
    calls.push(entry);
    record("adapter-post-send-message", entry);
    return response;
  };
}

async function runAdapterTurn(apiBaseUrl, deviceId, credentialFile, options = {}) {
  const backendCalls = [];
  const adapter = await Effect.runPromise(
    makeFenixAdapter(makeSettings(), {
      instanceId: ProviderInstanceId.make("fenix"),
      pairingSession: makeBridgeResolver(
        apiBaseUrl,
        deviceId,
        credentialFile,
        options.nowEpochMs ?? (() => Date.now()),
      ),
      fetch: makeLocalBackendFetch(apiBaseUrl, backendCalls),
    }),
  );
  const threadId = ThreadId.make(options.threadId ?? "fenix-e2e-thread");
  await Effect.runPromise(adapter.startSession({ threadId, runtimeMode: "full-access" }));
  const result = await Effect.runPromise(
    adapter.sendTurn({
      threadId,
      input: options.input ?? "Construye una respuesta Fenix Code de prueba",
      ...(options.model
        ? {
            modelSelection: {
              instanceId: ProviderInstanceId.make("fenix"),
              model: options.model,
              options: [],
            },
          }
        : {}),
    }),
  );
  const thread = await Effect.runPromise(adapter.readThread(threadId));
  return { result, thread, backendCalls };
}

async function runAdapterTurnExpectError(apiBaseUrl, deviceId, credentialFile, options = {}) {
  const backendCalls = [];
  const adapter = await Effect.runPromise(
    makeFenixAdapter(makeSettings(), {
      instanceId: ProviderInstanceId.make("fenix"),
      pairingSession: makeBridgeResolver(
        apiBaseUrl,
        deviceId,
        credentialFile,
        options.nowEpochMs ?? (() => Date.now()),
      ),
      fetch: makeLocalBackendFetch(apiBaseUrl, backendCalls),
    }),
  );
  const threadId = ThreadId.make(options.threadId ?? "fenix-e2e-negative");
  await Effect.runPromise(adapter.startSession({ threadId, runtimeMode: "full-access" }));
  try {
    await Effect.runPromise(
      adapter.sendTurn({
        threadId,
        input: options.input ?? "negative",
        ...(options.model
          ? {
              modelSelection: {
                instanceId: ProviderInstanceId.make("fenix"),
                model: options.model,
                options: [],
              },
            }
          : {}),
      }),
    );
    throw new Error("Expected adapter turn to fail.");
  } catch (error) {
    return { error, backendCalls };
  }
}

async function main() {
  const monorepoRoot = process.env[MONOREPO_ENV]?.trim();
  if (!monorepoRoot) {
    console.error(usage());
    process.exit(2);
  }

  const port = await allocatePort();
  const apiBaseUrl = `http://127.0.0.1:${port}`;
  const resolvedMonorepoRoot = NodePath.resolve(monorepoRoot);
  const { tempDir, projectFile } = await createHarnessProject(resolvedMonorepoRoot, port);
  const { child, readOutput } = spawnDotnet(projectFile);
  let cleanedProcess = false;
  let succeeded = false;
  let cleanupError = null;

  try {
    await waitForHealth(apiBaseUrl);
    record("local-monorepo-api-started", {
      token: OWNER_RELAY_TOKEN,
      apiBaseUrl,
      pid: child.pid,
      monorepoRoot: resolvedMonorepoRoot,
      production: false,
      providersReal: false,
    });

    const paired = await requestJson(apiBaseUrl, "/__e2e/pair-device", {
      step: "pair-device",
      body: {},
    });
    assert(paired.response.ok, "Device pairing failed.");
    const deviceId = paired.payload?.device?.deviceId;
    const deviceCredential = paired.payload?.deviceCredential;
    assert(typeof deviceId === "string" && DEVICE_ID_PATTERN.test(deviceId), "Invalid device id.");
    assert(
      typeof deviceCredential === "string" && deviceCredential.length >= 32,
      "Invalid device credential.",
    );

    const lexicalCredentialFile = NodePath.join(tempDir, "device-credential");
    await NodeFSP.writeFile(lexicalCredentialFile, `${deviceCredential}\n`, { mode: 0o600 });
    await NodeFSP.chmod(lexicalCredentialFile, 0o600);
    const credentialFile = await NodeFSP.realpath(lexicalCredentialFile);
    const credentialStat = await NodeFSP.stat(credentialFile);
    assert((credentialStat.mode & 0o077) === 0, "Device credential file is not 0600.");
    record("credential-file", { path: credentialFile, mode: "0600", persistedInRepo: false });

    const directCredentialEnvelope = await requestJson(
      apiBaseUrl,
      `/api/v1/code-lab/companion/devices/${encodeURIComponent(deviceId)}/fenix-credential`,
      {
        step: "direct-fenix-credential-envelope",
        body: {
          deviceCredential,
          audience: FENIX_AUDIENCE,
        },
      },
    );
    assert(
      directCredentialEnvelope.response.ok,
      `Direct Fenix credential endpoint failed with ${directCredentialEnvelope.response.status}.`,
    );

    const initialSnapshot = await Effect.runPromise(
      resolvePairingSessionSnapshotFromHttp({
        baseUrl: apiBaseUrl,
        deviceId,
        deviceCredentialFile: credentialFile,
        nowEpochMs: () => Date.now(),
      }),
    );
    assert(initialSnapshot?.session.kind === "bearer", "Initial bridge snapshot was not active.");
    record("initial-bridge-snapshot", {
      kind: initialSnapshot.session.kind,
      expiresAtEpochMs: initialSnapshot.expiresAtEpochMs,
      tenantScope: initialSnapshot.tenantScope,
    });

    const happy = await runAdapterTurn(apiBaseUrl, deviceId, credentialFile);
    assert(happy.backendCalls.length === 1, "Happy path did not reach ChatModels exactly once.");
    assert(
      happy.backendCalls[0].response.status === 200,
      "Happy path ChatModels request did not return 200.",
    );
    assert(happy.thread.turns.length === 1, "Happy path thread did not record one turn.");
    record("happy-path", {
      turnId: happy.result.turnId,
      turns: happy.thread.turns.length,
      response: "contract-valid",
    });

    const activeSnapshot = await Effect.runPromise(
      resolvePairingSessionSnapshotFromHttp({
        baseUrl: apiBaseUrl,
        deviceId,
        deviceCredentialFile: credentialFile,
        nowEpochMs: () => Date.now(),
      }),
    );
    assert(activeSnapshot?.session.kind === "bearer", "Bridge did not resolve an active bearer.");
    const directMalformed = await requestJson(apiBaseUrl, CHAT_MODELS_PATH, {
      step: "malformed-payload",
      headers: { authorization: `Bearer ${activeSnapshot.session.token}` },
      body: {
        message: "payload malformado",
        model: DEFAULT_MODEL,
        isGenericChatLane: true,
        source: "fenix-code",
        threadId: "../escape",
        turnId: "bad turn",
        requestId: "bad-request",
      },
    });
    assert(directMalformed.response.status === 400, "Malformed payload was not rejected with 400.");

    const expired = await Effect.runPromise(
      resolvePairingSessionSnapshotFromHttp({
        baseUrl: apiBaseUrl,
        deviceId,
        deviceCredentialFile: credentialFile,
        nowEpochMs: () => Date.now() + 120_000,
      }),
    );
    assert(expired === null, "Expired client-side credential window did not fail closed.");
    record("expired-credential", { result: "snapshot-null-before-send" });

    let rateLimitedStatus = 0;
    for (let index = 0; index <= 20; index++) {
      const negative = await runAdapterTurnExpectError(apiBaseUrl, deviceId, credentialFile, {
        threadId: `fenix-e2e-unknown-${index}`,
        model: `invented-${index}/model`,
      });
      const status = negative.backendCalls[0]?.response.status ?? 0;
      if (index < 20)
        assert(status === 400, `Unknown provider request ${index} expected 400, got ${status}.`);
      else rateLimitedStatus = status;
    }
    assert(
      rateLimitedStatus === 429,
      `Unknown provider bucket did not return 429, got ${rateLimitedStatus}.`,
    );
    record("unknown-provider-rate-limit", {
      firstTwenty: "400 model_unavailable",
      requestTwentyOne: rateLimitedStatus,
      bucket: "unknown",
    });

    const mismatchMode = await requestJson(apiBaseUrl, "/__e2e/mode", {
      step: "owner-mismatch-mode-on",
      body: { ownerMismatch: true },
    });
    assert(mismatchMode.response.ok, "Failed to enable owner mismatch mode.");
    const mismatch = await runAdapterTurnExpectError(apiBaseUrl, deviceId, credentialFile, {
      threadId: "fenix-e2e-owner-mismatch",
    });
    assert(mismatch.backendCalls.length === 0, "Owner mismatch reached ChatModels unexpectedly.");
    assert(
      String(mismatch.error?.message ?? mismatch.error).includes("active Code Lab pairing session"),
      "Owner mismatch did not fail as a clean unpaired adapter error.",
    );
    record("owner-mismatch-revocation", {
      result: "adapter-failed-before-send",
      chatModelsCalls: mismatch.backendCalls.length,
    });

    const stats = await requestJson(apiBaseUrl, "/__e2e/stats", {
      method: "GET",
      step: "local-monorepo-stats",
    });
    assert(stats.response.ok, "Stats endpoint failed.");
    succeeded = true;
  } catch (error) {
    if (transcript.length > 0) {
      console.error("---- sanitized transcript ----");
      console.error(JSON.stringify(transcript, null, 2));
      console.error("---- end sanitized transcript ----");
    }
    const output = readOutput().trim();
    if (output.length > 0) {
      console.error("---- local monorepo API output ----");
      console.error(output);
      console.error("---- end local monorepo API output ----");
    }
    throw error;
  } finally {
    cleanedProcess = await stopProcess(child);
    const stillAlive = await processExists(child.pid);
    record("cleanup", {
      dotnetProcessTerminated: cleanedProcess,
      processStillAlive: stillAlive,
    });
    await NodeFSP.rm(tempDir, { recursive: true, force: true });
    if (stillAlive) {
      console.error(readOutput());
      cleanupError = new Error(
        `Local monorepo API process ${child.pid} is still alive after cleanup.`,
      );
    }
  }
  if (cleanupError) {
    throw cleanupError;
  }
  if (succeeded) {
    console.log(JSON.stringify({ ok: true, transcript }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
