import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repoRoot = NodePath.dirname(
  NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url))),
);
const mobileRoot = NodePath.join(repoRoot, "apps/mobile");
const require = NodeModule.createRequire(import.meta.url);
const expoCliPath = require.resolve("expo/bin/cli", { paths: [mobileRoot] });
const inspectedFiles = [
  "apps/mobile/app.config.ts",
  "apps/mobile/eas.json",
  "apps/mobile/README.md",
];
const forbidden = [
  ["upstream Expo project", "d763fcb8-d37c-41ea-a773-b54a0ab4a454"],
  ["upstream Expo owner", "pingdotgg"],
  ["upstream Apple team", "ARK85ZXQ4Z"],
  ["upstream App Store app", "6787819824"],
  ["upstream product name", "T3 Code"],
  ["upstream public domain", "t3.codes"],
  ["legacy mobile release environment", "T3CODE_"],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isUnsetPublicManifestValue(value) {
  return value == null || (typeof value === "object" && Object.keys(value).length === 0);
}

function inspectSourceFiles() {
  for (const relativePath of inspectedFiles) {
    const source = NodeFS.readFileSync(NodePath.join(repoRoot, relativePath), "utf8");
    for (const [label, value] of forbidden) {
      assert(!source.includes(value), `${relativePath} contains ${label}: ${value}`);
    }
  }
}

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env, ...overrides, APP_VARIANT: "production", EXPO_NO_DOTENV: "1" };
  for (const name of Object.keys(env)) {
    if (
      name.startsWith("FENIX_CODE_EXPO_") ||
      name.startsWith("FENIX_CODE_IOS_") ||
      name.startsWith("EXPO_PUBLIC_CLERK_") ||
      name.startsWith("EXPO_PUBLIC_OTLP_") ||
      name === "FENIX_CODE_RELAY_URL"
    ) {
      delete env[name];
    }
  }
  return { ...env, ...overrides };
}

function resolveExpoConfig(overrides = {}) {
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    [expoCliPath, "config", "--type", "public", "--json"],
    {
      cwd: mobileRoot,
      env: cleanEnvironment(overrides),
      encoding: "utf8",
    },
  );
  assert(
    result.status === 0,
    result.error?.message || result.stderr || result.stdout || "Expo config failed",
  );
  return JSON.parse(result.stdout);
}

function inspectFailClosedConfig() {
  const config = resolveExpoConfig();
  const serialized = JSON.stringify(config);

  assert(config.name === "Fenix Code", `Unexpected mobile name: ${String(config.name)}`);
  assert(config.scheme === "fenixcode", `Unexpected production scheme: ${String(config.scheme)}`);
  assert(config.owner === undefined, "Fresh config must not select an Expo owner");
  assert(config.updates?.enabled === false, "Fresh config must disable OTA updates");
  assert(config.extra?.eas?.projectId === undefined, "Fresh config must not select an EAS project");
  assert(config.ios?.appleTeamId === undefined, "Fresh config must not select an Apple team");
  assert(
    isUnsetPublicManifestValue(config.extra?.relay?.url),
    "Fresh config must not select a relay",
  );
  assert(
    isUnsetPublicManifestValue(config.extra?.clerk?.publishableKey),
    "Fresh config must not select Clerk",
  );

  for (const [label, value] of forbidden) {
    assert(!serialized.includes(value), `Resolved config contains ${label}: ${value}`);
  }
}

function inspectExplicitFenixDistributionConfig() {
  const projectId = "11111111-2222-4333-8444-555555555555";
  const config = resolveExpoConfig({
    FENIX_CODE_EXPO_OWNER: "aiworks-fenix",
    FENIX_CODE_EXPO_PROJECT_ID: projectId,
    FENIX_CODE_IOS_TEAM_ID: "FENIX12345",
  });

  assert(config.owner === "aiworks-fenix", "Explicit Fenix Expo owner was not preserved");
  assert(
    config.extra?.eas?.projectId === projectId,
    "Explicit Fenix EAS project was not preserved",
  );
  assert(config.updates?.url === `https://u.expo.dev/${projectId}`, "OTA URL was not derived");
  assert(config.ios?.appleTeamId === "FENIX12345", "Explicit Fenix Apple team was not preserved");
}

inspectSourceFiles();
inspectFailClosedConfig();
inspectExplicitFenixDistributionConfig();
process.stdout.write("mobile-release-config-pass\n");
