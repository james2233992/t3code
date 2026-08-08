#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

scan_paths=(
  apps/server/src
  apps/web/index.html
  apps/web/src
  apps/desktop/src
  apps/mobile/src
  apps/marketing/src
  infra/relay/src
  packages/contracts/src
  packages/shared/src
  scripts
)

common_args=(
  --hidden
  --no-messages
  --with-filename
  -I
  -n
  --glob
  '!**/*.test.*'
  --glob
  '!**/*.spec.*'
  --glob
  '!**/*.md'
  --glob
  '!scripts/fenix/**'
)

visible_brand_hits="$(
  rg "${common_args[@]}" \
    -e 'T3 Connect|T3 Tools|aria-label="T3"|accessibilityLabel="T3"|["'\'']T3["'\'']|>T3<' \
    -e '["'\''][^"'\'']*T3 Code[^"'\'']*["'\'']' \
    "${scan_paths[@]}" |
    grep -v '^packages/shared/src/productBranding.ts:2:export const PRODUCT_LEGACY_BASE_NAME = "T3 Code";' |
    grep -v '^2:export const PRODUCT_LEGACY_BASE_NAME = "T3 Code";' || true
)"

if [[ -n "$visible_brand_hits" ]]; then
  echo "Visible T3 branding remains in live source:" >&2
  echo "$visible_brand_hits" >&2
  exit 1
fi

domain_hits="$(
  rg "${common_args[@]}" \
    -e 'https?://[^"'\'')` ]*(t3\.codes|app\.t3\.codes|clerk\.t3\.codes)' \
    -e '\b(t3\.codes|app\.t3\.codes|clerk\.t3\.codes)\b' \
    "${scan_paths[@]}" || true
)"

if [[ -n "$domain_hits" ]]; then
  echo "T3 hosted domains remain in live source:" >&2
  echo "$domain_hits" >&2
  exit 1
fi

echo "visible-branding-pass"
