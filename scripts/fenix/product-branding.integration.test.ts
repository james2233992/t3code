import { assert, describe, it } from "@effect/vitest";

import mobilePackageJson from "../../apps/mobile/package.json" with { type: "json" };
import { config as vercelConfig } from "../../apps/web/vercel.ts";
import {
  PRODUCT_HOSTED_APP_DOMAIN,
  PRODUCT_LATEST_HOSTED_APP_DOMAIN,
  PRODUCT_MOBILE_DEVELOPMENT_SCHEME,
  PRODUCT_MOBILE_PREVIEW_SCHEME,
  PRODUCT_MOBILE_PRODUCTION_SCHEME,
  PRODUCT_NIGHTLY_HOSTED_APP_DOMAIN,
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
    assert.include(
      scripts["dev:client:preview"],
      `--scheme ${PRODUCT_MOBILE_PREVIEW_SCHEME}`,
    );
    assert.include(scripts.showcase, `--scheme ${PRODUCT_MOBILE_PRODUCTION_SCHEME}`);
    assert.notInclude(JSON.stringify(scripts), "--scheme t3code");
  });

});
