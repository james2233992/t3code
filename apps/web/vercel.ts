import { matchers, routes, type Transform, type VercelConfig } from "@vercel/config/v1";
import {
  PRODUCT_HOSTED_APP_DOMAIN,
  PRODUCT_LATEST_HOSTED_APP_DOMAIN,
  PRODUCT_NIGHTLY_HOSTED_APP_DOMAIN,
  PRODUCT_WEB_CHANNEL_COOKIE,
  PRODUCT_WEB_CHANNEL_PATH,
} from "@t3tools/shared/productBranding";

const ROUTER_HOST = PRODUCT_HOSTED_APP_DOMAIN;
const HOSTED_WEB_CHANNEL_COOKIE = PRODUCT_WEB_CHANNEL_COOKIE;
const LATEST_ORIGIN = `https://${PRODUCT_LATEST_HOSTED_APP_DOMAIN}`;
const NIGHTLY_ORIGIN = `https://${PRODUCT_NIGHTLY_HOSTED_APP_DOMAIN}`;
const CLEAN_CHANNEL_QUERY_TRANSFORMS = [
  {
    type: "request.query",
    op: "delete",
    target: { key: "channel" },
  },
] satisfies Transform[];

function channelCookie(channel: "latest" | "nightly"): string {
  return [
    `${HOSTED_WEB_CHANNEL_COOKIE}=${channel}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export const config: VercelConfig = {
  buildCommand:
    'vp run --filter @t3tools/web build && node ../../scripts/apply-web-brand-assets.ts --channel "${VITE_HOSTED_APP_CHANNEL:-latest}"',
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "npm install -g vite-plus && vp install --ignore-scripts --filter '@t3tools/scripts...' --filter '@t3tools/web...'",
  routes: [
    {
      src: PRODUCT_WEB_CHANNEL_PATH,
      has: [matchers.query("channel", "nightly")],
      transforms: CLEAN_CHANNEL_QUERY_TRANSFORMS,
      headers: {
        Location: "/",
        "Set-Cookie": channelCookie("nightly"),
      },
      status: 302,
    },
    {
      src: PRODUCT_WEB_CHANNEL_PATH,
      transforms: CLEAN_CHANNEL_QUERY_TRANSFORMS,
      headers: {
        Location: "/",
        "Set-Cookie": channelCookie("latest"),
      },
      status: 302,
    },
    {
      src: "/(.*)",
      has: [matchers.host(ROUTER_HOST), matchers.cookie(HOSTED_WEB_CHANNEL_COOKIE, "nightly")],
      dest: `${NIGHTLY_ORIGIN}/$1`,
    },
    {
      src: "/(.*)",
      has: [matchers.host(ROUTER_HOST)],
      dest: `${LATEST_ORIGIN}/$1`,
    },
  ],
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
