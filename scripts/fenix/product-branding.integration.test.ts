import { assert, describe, it } from "@effect/vitest";

import mobilePackageJson from "../../apps/mobile/package.json" with { type: "json" };
import {
  DESKTOP_RELEASE_TAG_URL,
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateInstallConfirmationMessage,
} from "../../apps/web/src/components/desktopUpdate.logic.ts";
import { config as vercelConfig } from "../../apps/web/vercel.ts";
import {
  PRODUCT_BASE_NAME,
  PRODUCT_HOSTED_APP_DOMAIN,
  PRODUCT_LATEST_HOSTED_APP_DOMAIN,
  PRODUCT_MOBILE_DEVELOPMENT_SCHEME,
  PRODUCT_MOBILE_PREVIEW_SCHEME,
  PRODUCT_MOBILE_PRODUCTION_SCHEME,
  PRODUCT_NIGHTLY_HOSTED_APP_DOMAIN,
  PRODUCT_REPOSITORY_URL,
  PRODUCT_WEB_CHANNEL_PATH,
} from "@t3tools/shared/productBranding";

describe("Fenix product branding integration", () => {
  it("keeps hosted routing on Fenix-owned domains", () => {
    const serializedConfig = JSON.stringify(vercelConfig);

    assert.include(serializedConfig, PRODUCT_HOSTED_APP_DOMAIN);
    assert.include(serializedConfig, PRODUCT_LATEST_HOSTED_APP_DOMAIN);
    assert.include(serializedConfig, PRODUCT_NIGHTLY_HOSTED_APP_DOMAIN);
    assert.include(serializedConfig, PRODUCT_WEB_CHANNEL_PATH);
    assert.notInclude(serializedConfig, "app.t3.codes");
    assert.notInclude(serializedConfig, "latest.app.t3.codes");
    assert.notInclude(serializedConfig, "nightly.app.t3.codes");
  });

  it("keeps mobile scripts aligned with Expo schemes", () => {
    const scripts = mobilePackageJson.scripts as Record<string, string>;

    assert.include(scripts["dev:client"], `--scheme ${PRODUCT_MOBILE_DEVELOPMENT_SCHEME}`);
    assert.include(scripts["dev:client:preview"], `--scheme ${PRODUCT_MOBILE_PREVIEW_SCHEME}`);
    assert.include(scripts.showcase, `--scheme ${PRODUCT_MOBILE_PRODUCTION_SCHEME}`);
    assert.notInclude(JSON.stringify(scripts), "--scheme t3code");
  });

  it("keeps desktop updater release links and visible copy on Fenix branding", () => {
    const warning = getArm64IntelBuildWarningDescription({
      enabled: true,
      status: "available",
      channel: "latest",
      currentVersion: "1.0.0",
      hostArch: "arm64",
      appArch: "x64",
      runningUnderArm64Translation: true,
      availableVersion: "1.1.0",
      downloadedVersion: null,
      releaseNotes: [],
      downloadPercent: null,
      checkedAt: null,
      message: null,
      errorContext: null,
      canRetry: false,
    });
    const installConfirmation = getDesktopUpdateInstallConfirmationMessage(
      {
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
      },
      "Win32",
    );
    const serializedUpdaterCopy = JSON.stringify({
      releaseTagUrl: DESKTOP_RELEASE_TAG_URL,
      warning,
      installConfirmation,
    });

    assert.strictEqual(DESKTOP_RELEASE_TAG_URL, `${PRODUCT_REPOSITORY_URL}/releases/tag`);
    assert.include(serializedUpdaterCopy, PRODUCT_BASE_NAME);
    assert.notInclude(serializedUpdaterCopy, "pingdotgg/t3code/releases");
    assert.notInclude(serializedUpdaterCopy, "T3 Code");
  });
});
