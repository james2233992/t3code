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
  packages/client-runtime/src
  packages/shared/src
  scripts
)

legacy_web_icon_sha256=(
  "7fdcd08e83aedc4fc0d15a015a171b7bbd6025d37b2861e6ceb29a571813a91a"
  "347273f37a0bcdc0e9b168ff1252a33ad297271f5a84ad412c18c5e5ede8f450"
  "25f17fd73b3ecdebf05609b7f7625b824f490e017147ed56dc1dcb85251754e4"
  "4943ac41cc004f826c95d6da34e0b04c387cf54982fc424ba3da8b68dc4598db"
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

sha256_file() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{ print $1 }'
    return
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{ print $1 }'
    return
  fi
  echo "sha256sum or shasum is required for binary branding checks." >&2
  return 127
}

verify_nonlegacy_favicon() {
  local file_path="$1"
  local forbidden_hash="$2"
  if [[ ! -f "$file_path" ]]; then
    echo "Required Fenix favicon is missing: $file_path" >&2
    return 1
  fi
  local actual_hash
  actual_hash="$(sha256_file "$file_path")"
  if [[ "$actual_hash" == "$forbidden_hash" ]]; then
    echo "Legacy T3 favicon remains at $file_path" >&2
    return 1
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

  local source_icons=(
    "assets/prod/fenix-web-favicon.ico"
    "assets/prod/fenix-web-favicon-16x16.png"
    "assets/prod/fenix-web-favicon-32x32.png"
    "assets/prod/fenix-web-apple-touch-180.png"
  )
  local public_icons=(
    "apps/web/public/favicon.ico"
    "apps/web/public/favicon-16x16.png"
    "apps/web/public/favicon-32x32.png"
    "apps/web/public/apple-touch-icon.png"
  )
  local index
  for index in "${!source_icons[@]}"; do
    verify_nonlegacy_favicon "${source_icons[$index]}" "${legacy_web_icon_sha256[$index]}"
    verify_nonlegacy_favicon "${public_icons[$index]}" "${legacy_web_icon_sha256[$index]}"
    if [[ "$(sha256_file "${source_icons[$index]}")" != "$(sha256_file "${public_icons[$index]}")" ]]; then
      echo "The public icon does not match its Fenix production source: ${public_icons[$index]}" >&2
      return 1
    fi
  done

  local raw_visible_hits
  local visible_brand_hits
  raw_visible_hits="$(
    run_rg_allow_no_matches "${common_args[@]}" \
    -e 'T3 Connect|T3 Tools|aria-label="T3"|accessibilityLabel="T3"|["'\'']T3["'\'']|>T3<' \
    -e '["'\''][^"'\'']*T3 Code[^"'\'']*["'\'']' \
    -e 'Run `(?:npx )?t3(?:@[^ `]+)?[ `]|Reconnected on t3@|installed[^"'\'']*t3@|Please[^"'\'']*npx t3|Selected t3@|did not resume on t3@|The t3@|Command\.make\("t3"' \
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
  local binary_test_file
  binary_test_file="$(mktemp "${TMPDIR:-/tmp}/fenix-branding-binary.XXXXXX")"
  local red_output
  local red_status

  trap 'rm -f "$test_file" "$binary_test_file"' RETURN
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

  printf 'export const visibleCommandRegression = "Run `t3 connect`";\n' > "$test_file"
  set +e
  red_output="$(run_checks 2>&1)"
  red_status=$?
  set -e
  if [[ "$red_status" -eq 0 || "$red_output" != *"visibleCommandRegression"* ]]; then
    echo "selftest failed: visible upstream command fixture was not detected." >&2
    echo "$red_output" >&2
    return 1
  fi

  printf 'legacy-binary-brand-fixture' > "$binary_test_file"
  local binary_fixture_hash
  binary_fixture_hash="$(sha256_file "$binary_test_file")"
  set +e
  red_output="$(verify_nonlegacy_favicon "$binary_test_file" "$binary_fixture_hash" 2>&1)"
  red_status=$?
  set -e
  if [[ "$red_status" -eq 0 || "$red_output" != *"Legacy T3 favicon remains"* ]]; then
    echo "selftest failed: legacy binary fixture was not detected." >&2
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
