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

require_rg() {
  if ! command -v rg >/dev/null 2>&1; then
    echo "ripgrep (rg) is required for visible branding checks." >&2
    return 127
  fi
}

run_rg_allow_no_matches() {
  local output
  local status

  set +e
  output="$(rg "$@" 2>&1)"
  status=$?
  set -e

  if [[ "$status" -eq 0 || "$status" -eq 1 ]]; then
    printf '%s' "$output"
    return 0
  fi

  echo "rg failed while scanning visible branding:" >&2
  printf '%s\n' "$output" >&2
  return "$status"
}

filter_allowed_visible_hits() {
  awk '
    $0 == "packages/shared/src/productBranding.ts:2:export const PRODUCT_LEGACY_BASE_NAME = \"T3 Code\";" { next }
    $0 == "2:export const PRODUCT_LEGACY_BASE_NAME = \"T3 Code\";" { next }
    { print }
  '
}

run_checks() {
  require_rg

  local raw_visible_hits
  local visible_brand_hits
  raw_visible_hits="$(
    run_rg_allow_no_matches "${common_args[@]}" \
    -e 'T3 Connect|T3 Tools|aria-label="T3"|accessibilityLabel="T3"|["'\'']T3["'\'']|>T3<' \
    -e '["'\''][^"'\'']*T3 Code[^"'\'']*["'\'']' \
    "${scan_paths[@]}"
  )"
  visible_brand_hits="$(printf '%s\n' "$raw_visible_hits" | filter_allowed_visible_hits)"

  if [[ -n "$visible_brand_hits" ]]; then
    echo "Visible T3 branding remains in live source:" >&2
    echo "$visible_brand_hits" >&2
    return 1
  fi

  local domain_hits
  domain_hits="$(
    run_rg_allow_no_matches "${common_args[@]}" \
    -e 'https?://[^"'\'')` ]*(t3\.codes|app\.t3\.codes|clerk\.t3\.codes)' \
    -e '\b(t3\.codes|app\.t3\.codes|clerk\.t3\.codes)\b' \
    "${scan_paths[@]}"
  )"

  if [[ -n "$domain_hits" ]]; then
    echo "T3 hosted domains remain in live source:" >&2
    echo "$domain_hits" >&2
    return 1
  fi
}

selftest() {
  require_rg

  local test_file="apps/web/src/__fenix_visible_branding_guard_red_test__.$$.ts"
  local red_output
  local red_status

  trap 'rm -f "$test_file"' RETURN
  printf 'export const visibleBrandRegression = "T3 Code";\n' > "$test_file"

  set +e
  red_output="$(run_checks 2>&1)"
  red_status=$?
  set -e

  if [[ "$red_status" -eq 0 ]]; then
    echo "selftest failed: visible T3 fixture was not detected." >&2
    return 1
  fi

  if [[ "$red_output" != *"$test_file"* && "$red_output" != *"visibleBrandRegression"* ]]; then
    echo "selftest failed: red case failed for an unexpected reason." >&2
    echo "$red_output" >&2
    return 1
  fi

  rm -f "$test_file"
  run_checks
  echo "visible-branding-selftest-pass"
}

case "${1:-check}" in
  check)
    run_checks
    echo "visible-branding-pass"
    ;;
  selftest)
    selftest
    ;;
  *)
    echo "usage: $0 [check|selftest]" >&2
    exit 64
    ;;
esac
