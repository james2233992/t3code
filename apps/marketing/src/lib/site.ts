import { PRODUCT_BASE_NAME, PRODUCT_REPOSITORY_URL } from "@t3tools/shared/productBranding";

export const PRODUCT_NAME = PRODUCT_BASE_NAME;
export const GITHUB_REPOSITORY_URL = PRODUCT_REPOSITORY_URL;
export const GITHUB_RELEASES_URL = `${PRODUCT_REPOSITORY_URL}/releases`;

export const IOS_APP_STORE_URL: string | null = null;

export const ANDROID_PLAY_STORE_URL: string | null = null;

export const MARKETING_STATS = {
  githubStars: "14k+",
  users: "100,000",
} as const;
