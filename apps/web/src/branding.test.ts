import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  PRODUCT_HOSTED_APP_DOMAIN,
  PRODUCT_LATEST_HOSTED_APP_DOMAIN,
  PRODUCT_NIGHTLY_HOSTED_APP_DOMAIN,
  PRODUCT_WEB_CHANNEL_PATH,
} from "@t3tools/shared/productBranding";
import { config as vercelConfig } from "../vercel";
import {
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.logic";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.resetModules();

  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("branding", () => {
  it("uses injected desktop branding when available", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopBridge: {
          getAppBranding: () => ({
            baseName: "Fenix Code",
            stageLabel: "Nightly",
            displayName: "Fenix Code (Nightly)",
          }),
        },
      },
    });

    const branding = await import("./branding");

    expect(branding.APP_BASE_NAME).toBe("Fenix Code");
    expect(branding.APP_STAGE_LABEL).toBe("Nightly");
    expect(branding.APP_DISPLAY_NAME).toBe("Fenix Code (Nightly)");
  });

  it("normalizes hosted app channel metadata", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("nightly");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Nocturna");
    expect(branding.APP_STAGE_LABEL).toBe("Nocturna");
    expect(branding.APP_DISPLAY_NAME).toBe("Fenix Code (Nocturna)");
  });

  it("does not label the latest hosted app channel", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "latest");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBe("latest");
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBe("Latest");
    expect(branding.APP_STAGE_LABEL).toBe("Latest");
    expect(branding.APP_DISPLAY_NAME).toBe("Fenix Code");
  });

  it("ignores unknown hosted app channels", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "preview");

    const branding = await import("./branding");

    expect(branding.HOSTED_APP_CHANNEL).toBeNull();
    expect(branding.HOSTED_APP_CHANNEL_LABEL).toBeNull();
  });
});

describe("branding logic", () => {
  it("returns the Spanish label for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nocturna");
  });

  it("updates the display name for nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Fenix Code",
        fallbackDisplayName: "Fenix Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616.12",
      }),
    ).toBe("Fenix Code (Nocturna)");
  });

  it("keeps the fallback display name for stable primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Fenix Code",
        fallbackDisplayName: "Fenix Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.27",
      }),
    ).toBe("Fenix Code (Alpha)");
  });

  it("keeps the fallback display name for malformed nightly primary server versions", () => {
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "Fenix Code",
        fallbackDisplayName: "Fenix Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616",
      }),
    ).toBe("Fenix Code (Alpha)");
  });
});

describe("hosted branding", () => {
  it("keeps hosted routing on Fenix-owned domains", () => {
    const serializedConfig = JSON.stringify(vercelConfig);

    expect(serializedConfig).toContain(PRODUCT_HOSTED_APP_DOMAIN);
    expect(serializedConfig).toContain(PRODUCT_LATEST_HOSTED_APP_DOMAIN);
    expect(serializedConfig).toContain(PRODUCT_NIGHTLY_HOSTED_APP_DOMAIN);
    expect(serializedConfig).toContain(PRODUCT_WEB_CHANNEL_PATH);
    expect(serializedConfig).not.toContain("app.t3.codes");
    expect(serializedConfig).not.toContain("latest.app.t3.codes");
    expect(serializedConfig).not.toContain("nightly.app.t3.codes");
  });
});
