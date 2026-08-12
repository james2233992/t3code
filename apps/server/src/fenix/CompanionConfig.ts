// @effect-diagnostics-next-line nodeBuiltinImport:off - atomic 0600 credential replacement needs Node open/rename semantics.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off - this portable config module is also consumed outside an Effect layer.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export const FENIX_COMPANION_CONFIG_FILE = "fenix-companion.json";
export const FENIX_COMPANION_CAPABILITIES = ["rpc", "workspace.local", "git.clone"] as const;

export interface FenixCompanionConfig {
  readonly version: 1;
  readonly portalOrigin: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly deviceCredential: string;
  readonly allowedRoots: ReadonlyArray<string>;
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function normalizeFenixPortalOrigin(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The Fenix portal URL must not contain credentials, query, or fragment data.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("The Fenix portal must use HTTPS (HTTP is allowed only on loopback). ");
  }
  url.pathname = "/";
  return url.origin;
}

export async function canonicalizeFenixCompanionRoot(value: string): Promise<string> {
  const resolved = NodePath.resolve(value.trim());
  const stat = await NodeFSP.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`The allowed root is not a directory: ${resolved}`);
  }
  return NodeFSP.realpath(resolved);
}

function pathIsInside(root: string, candidate: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${NodePath.sep}`) && relative !== "..");
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

async function canonicalAllowedRoots(stateDir: string): Promise<ReadonlyArray<string>> {
  const config = await readFenixCompanionConfig(stateDir);
  if (config === null) {
    throw new Error("This Fenix Code server is not paired with the portal.");
  }
  return Promise.all(config.allowedRoots.map(canonicalizeFenixCompanionRoot));
}

async function nearestExistingAncestor(value: string): Promise<{
  readonly ancestor: string;
  readonly candidate: string;
}> {
  const resolved = NodePath.resolve(value.trim());
  let cursor = resolved;
  for (;;) {
    try {
      const canonicalAncestor = await NodeFSP.realpath(cursor);
      return {
        ancestor: canonicalAncestor,
        candidate: NodePath.join(canonicalAncestor, NodePath.relative(cursor, resolved)),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = NodePath.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
}

export async function requireFenixAllowedExistingPath(
  stateDir: string,
  value: string,
): Promise<string> {
  const [candidate, roots] = await Promise.all([
    NodeFSP.realpath(NodePath.resolve(value.trim())),
    canonicalAllowedRoots(stateDir),
  ]);
  if (!roots.some((root) => pathIsInside(root, candidate))) {
    throw new Error("The path is outside the local roots authorized for this Fenix pairing.");
  }
  return candidate;
}

export async function requireFenixAllowedDestinationPath(
  stateDir: string,
  value: string,
): Promise<string> {
  const [{ candidate }, roots] = await Promise.all([
    nearestExistingAncestor(value),
    canonicalAllowedRoots(stateDir),
  ]);
  if (!roots.some((root) => pathIsInside(root, candidate))) {
    throw new Error("The destination is outside the local roots authorized for this pairing.");
  }
  return candidate;
}

export async function requireFenixAllowedCloneSource(
  stateDir: string,
  remoteUrl: string,
): Promise<void> {
  const value = remoteUrl.trim();
  if (value.length === 0 || value.startsWith("-") || hasControlCharacter(value)) {
    throw new Error("The repository URL is malformed.");
  }
  if (NodePath.isAbsolute(value)) {
    await requireFenixAllowedExistingPath(stateDir, value);
    return;
  }
  if (/^[^\s/@:]+@[^\s/:]+:.+$/u.test(value)) return;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Use an absolute local path, file URL, HTTPS URL, Git URL, or SSH URL.");
  }
  if (parsed.protocol === "file:") {
    await requireFenixAllowedExistingPath(stateDir, NodeURL.fileURLToPath(parsed));
    return;
  }
  if (["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) return;
  throw new Error(`Repository URL protocol is not allowed: ${parsed.protocol}`);
}

function parseConfig(value: unknown): FenixCompanionConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("The Fenix companion configuration is malformed.");
  }
  const candidate = value as Partial<FenixCompanionConfig>;
  if (
    candidate.version !== 1 ||
    typeof candidate.portalOrigin !== "string" ||
    typeof candidate.deviceId !== "string" ||
    candidate.deviceId.length < 16 ||
    typeof candidate.deviceName !== "string" ||
    candidate.deviceName.trim().length === 0 ||
    typeof candidate.deviceCredential !== "string" ||
    candidate.deviceCredential.length < 32 ||
    !Array.isArray(candidate.allowedRoots) ||
    candidate.allowedRoots.length === 0 ||
    candidate.allowedRoots.some((root) => typeof root !== "string" || !NodePath.isAbsolute(root))
  ) {
    throw new Error("The Fenix companion configuration is incomplete or invalid.");
  }
  return {
    version: 1,
    portalOrigin: normalizeFenixPortalOrigin(candidate.portalOrigin),
    deviceId: candidate.deviceId,
    deviceName: candidate.deviceName.trim(),
    deviceCredential: candidate.deviceCredential,
    allowedRoots: [...new Set(candidate.allowedRoots)],
  };
}

export function fenixCompanionConfigPath(stateDir: string): string {
  return NodePath.join(stateDir, FENIX_COMPANION_CONFIG_FILE);
}

export async function readFenixCompanionConfig(
  stateDir: string,
): Promise<FenixCompanionConfig | null> {
  const configPath = fenixCompanionConfigPath(stateDir);
  try {
    return parseConfig(JSON.parse(await NodeFSP.readFile(configPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeFenixCompanionConfig(
  stateDir: string,
  config: FenixCompanionConfig,
): Promise<void> {
  const normalized = parseConfig({
    ...config,
    allowedRoots: await Promise.all(config.allowedRoots.map(canonicalizeFenixCompanionRoot)),
  });
  const configPath = fenixCompanionConfigPath(stateDir);
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await NodeFSP.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await NodeFSP.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  try {
    await NodeFSP.rename(temporaryPath, configPath);
    await NodeFSP.chmod(configPath, 0o600);
  } catch (error) {
    await NodeFSP.rm(temporaryPath, { force: true });
    throw error;
  }
}
