import { describe, expect, it } from "@effect/vitest";

import setupPageSource from "./components/fenix/FenixSetupPage.tsx?raw";
import {
  companionArtifactForPlatform,
  companionDownloadHref,
  detectFenixSetupArchitecture,
  detectFenixSetupArchitectureFromNavigator,
  detectFenixSetupPlatform,
  parseFenixCompanionManifest,
} from "./fenixSetup.ts";

const validManifest = {
  schemaVersion: 1,
  releaseVersion: "0.0.32-pilot.20260814",
  artifacts: [
    {
      platform: "macos",
      architecture: "arm64",
      fileName: "Fenix-Code-Companion-0.0.32-macos-arm64.tar.gz",
      sha256: "a".repeat(64),
      sizeBytes: 1024,
      available: true,
    },
  ],
};

describe("Fenix setup", () => {
  it("keeps the long setup landing scrollable inside the fixed app shell", () => {
    expect(setupPageSource).toContain(
      '<main className="h-full min-h-dvh overflow-x-hidden overflow-y-auto overscroll-y-auto',
    );
  });

  it("detects the three supported instruction lanes", () => {
    expect(detectFenixSetupPlatform("MacIntel")).toBe("macos");
    expect(detectFenixSetupPlatform("Win32")).toBe("windows");
    expect(detectFenixSetupPlatform("Linux x86_64")).toBe("linux");
  });

  it("rejects mobile Apple devices and unknown platforms", () => {
    expect(detectFenixSetupPlatform("iPhone")).toBeNull();
    expect(detectFenixSetupPlatform("iPad")).toBeNull();
    expect(detectFenixSetupPlatform("Nintendo Switch")).toBeNull();
  });

  it("does not guess Apple Silicon from the ambiguous MacIntel browser hint", () => {
    expect(detectFenixSetupArchitecture("MacIntel", "Mozilla/5.0 (Macintosh)")).toBeNull();
    expect(detectFenixSetupArchitecture("Mac ARM64", "Mozilla/5.0 (Macintosh)")).toBe("arm64");
  });

  it("uses a browser architecture hint when MacIntel is ambiguous", async () => {
    await expect(
      detectFenixSetupArchitectureFromNavigator({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh)",
        userAgentData: {
          getHighEntropyValues: async () => ({ architecture: "arm" }),
        },
      }),
    ).resolves.toBe("arm64");
  });

  it("accepts only a bounded, same-directory companion manifest", () => {
    const manifest = parseFenixCompanionManifest(validManifest);
    expect(companionArtifactForPlatform(manifest, "macos", "arm64")?.architecture).toBe("arm64");
    expect(companionArtifactForPlatform(manifest, "macos", "x64")).toBeNull();
    expect(companionDownloadHref("/code-lab/", manifest!.artifacts[0]!)).toBe(
      `/code-lab/downloads/Fenix-Code-Companion-0.0.32-macos-arm64.tar.gz?sha256=${"a".repeat(64)}`,
    );
  });

  it("fails closed on external paths, malformed hashes, or partial entries", () => {
    expect(
      parseFenixCompanionManifest({
        ...validManifest,
        artifacts: [{ ...validManifest.artifacts[0], fileName: "https://example.com/a.zip" }],
      }),
    ).toBeNull();
    expect(
      parseFenixCompanionManifest({
        ...validManifest,
        artifacts: [{ ...validManifest.artifacts[0], sha256: "not-a-hash" }],
      }),
    ).toBeNull();
    expect(
      parseFenixCompanionManifest({
        ...validManifest,
        artifacts: [{ platform: "macos", available: true }],
      }),
    ).toBeNull();
  });
});
