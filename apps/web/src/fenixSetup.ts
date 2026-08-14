export type FenixSetupPlatform = "macos" | "windows" | "linux";
export type FenixSetupArchitecture = "arm64" | "x64";

export interface FenixCompanionArtifact {
  readonly platform: FenixSetupPlatform;
  readonly architecture: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly available: boolean;
}

export interface FenixCompanionManifest {
  readonly schemaVersion: 1;
  readonly releaseVersion: string;
  readonly artifacts: ReadonlyArray<FenixCompanionArtifact>;
}

const PLATFORM_VALUES = new Set<FenixSetupPlatform>(["macos", "windows", "linux"]);
const SAFE_FILE_NAME = /^Fenix-Code-Companion-[A-Za-z0-9._-]+\.(?:tar\.gz|zip)$/;
const SHA_256 = /^[a-f0-9]{64}$/;

export function detectFenixSetupPlatform(platform: string): FenixSetupPlatform | null {
  if (/iphone|ipad|ipod/i.test(platform)) return null;
  if (/mac/i.test(platform)) return "macos";
  if (/win/i.test(platform)) return "windows";
  if (/linux|x11|cros/i.test(platform)) return "linux";
  return null;
}

export function detectFenixSetupArchitecture(
  platform: string,
  userAgent: string,
): FenixSetupArchitecture | null {
  const hint = `${platform} ${userAgent}`;
  if (/arm64|aarch64/i.test(hint)) return "arm64";
  if (/x86_64|x86-64|win64|x64/i.test(hint)) return "x64";
  return null;
}

interface FenixSetupNavigatorHints {
  readonly platform: string;
  readonly userAgent: string;
  readonly userAgentData?: {
    getHighEntropyValues(
      hints: ReadonlyArray<string>,
    ): Promise<{ readonly architecture?: unknown }>;
  };
}

export async function detectFenixSetupArchitectureFromNavigator(
  navigatorHints: FenixSetupNavigatorHints,
): Promise<FenixSetupArchitecture | null> {
  const direct = detectFenixSetupArchitecture(navigatorHints.platform, navigatorHints.userAgent);
  if (direct !== null) return direct;

  try {
    const architecture = (
      await navigatorHints.userAgentData?.getHighEntropyValues(["architecture"])
    )?.architecture;
    if (typeof architecture !== "string") return null;
    if (/^(?:arm|arm64|aarch64)$/i.test(architecture)) return "arm64";
    if (/^(?:x86|x86_64|x86-64|x64)$/i.test(architecture)) return "x64";
  } catch {
    return null;
  }
  return null;
}

export function parseFenixCompanionManifest(value: unknown): FenixCompanionManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.releaseVersion !== "string" ||
    manifest.releaseVersion.length === 0 ||
    !Array.isArray(manifest.artifacts)
  ) {
    return null;
  }

  const artifacts = manifest.artifacts.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const artifact = item as Record<string, unknown>;
    if (
      typeof artifact.platform !== "string" ||
      !PLATFORM_VALUES.has(artifact.platform as FenixSetupPlatform) ||
      typeof artifact.architecture !== "string" ||
      artifact.architecture.length === 0 ||
      typeof artifact.fileName !== "string" ||
      !SAFE_FILE_NAME.test(artifact.fileName) ||
      typeof artifact.sha256 !== "string" ||
      !SHA_256.test(artifact.sha256) ||
      typeof artifact.sizeBytes !== "number" ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes < 0 ||
      typeof artifact.available !== "boolean"
    ) {
      return [];
    }
    return [artifact as unknown as FenixCompanionArtifact];
  });

  if (artifacts.length !== manifest.artifacts.length) return null;
  return {
    schemaVersion: 1,
    releaseVersion: manifest.releaseVersion,
    artifacts,
  };
}

export function companionArtifactForPlatform(
  manifest: FenixCompanionManifest | null,
  platform: FenixSetupPlatform | null,
  architecture: FenixSetupArchitecture | null,
): FenixCompanionArtifact | null {
  if (platform === null || architecture === null) return null;
  return (
    manifest?.artifacts.find(
      (artifact) =>
        artifact.platform === platform &&
        artifact.architecture === architecture &&
        artifact.available,
    ) ?? null
  );
}

export function companionDownloadHref(baseUrl: string, artifact: FenixCompanionArtifact): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}downloads/${encodeURIComponent(artifact.fileName)}?sha256=${artifact.sha256}`;
}
