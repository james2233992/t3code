#!/usr/bin/env bash
set -euo pipefail

mode="${1:-check}"
case "$mode" in
  generate | check) ;;
  *)
    echo "usage: $0 [generate|check]" >&2
    exit 2
    ;;
esac

repo_root="$(git rev-parse --show-toplevel)"
out_dir="${repo_root}/docs/fenix"

common_rg_args=(
  --hidden
  --no-messages
  -I
  -o
  --glob
  '!.git/**'
  --glob
  '!.repos/**'
  --glob
  '!**/node_modules/**'
  --glob
  '!**/dist/**'
  --glob
  '!**/build/**'
  --glob
  '!**/.next/**'
  --glob
  '!**/.expo/**'
  --glob
  '!**/.turbo/**'
  --glob
  '!**/coverage/**'
  --glob
  '!pnpm-lock.yaml'
  --glob
  '!docs/fenix/branding-inventory-*.matches.txt'
  --glob
  '!docs/fenix/branding-inventory-*.files.txt'
)

textual_pattern='T3 Code|T3Code|T3 Tools|T3 Connect|t3code|t3-code|@t3tools|T3CODE'
platform_pattern='t3code|t3-code|T3CODE|com\.t3tools|@t3tools|t3\.json'
endpoint_pattern='github\.com/pingdotgg/t3code|app\.t3\.codes|clerk\.t3\.codes|t3\.codes|apps\.apple\.com/us/app/t3-code|play\.google\.com/store/apps/details\?id=com\.t3tools\.t3code'

run_match_inventory() {
  local pattern="$1"
  (
    cd "$repo_root"
    rg --json "${common_rg_args[@]}" -e "$pattern" . || true
  ) | jq -r '
    select(.type == "match")
    | .data as $data
    | $data.submatches[]
    | "\($data.path.text):\($data.line_number):\(.start + 1):\(.match.text)"
  ' | LC_ALL=C sort -u
}

generate_to() {
  local target_dir="$1"
  mkdir -p "$target_dir"

  run_match_inventory "$textual_pattern" > "${target_dir}/branding-inventory-textual.matches.txt"

  run_match_inventory "$platform_pattern" > "${target_dir}/branding-inventory-platform.matches.txt"

  run_match_inventory "$endpoint_pattern" > "${target_dir}/branding-inventory-endpoints-links.matches.txt"

  (
    cd "$repo_root"
    find assets apps/desktop apps/web apps/mobile apps/marketing \
      -type f \
      \( \
        -iname '*icon*' -o \
        -iname '*logo*' -o \
        -iname '*mark*' -o \
        -iname '*wordmark*' -o \
        -iname '*splash*' -o \
        -iname '*favicon*' \
      \) \
      -not -path '*/node_modules/*' \
      -not -path '*/dist/*' \
      -not -path '*/build/*' \
      -not -path '*/.expo/*' \
      -not -path '*/.turbo/*' \
      | LC_ALL=C sort
  ) > "${target_dir}/branding-inventory-visual.files.txt"
}

if [[ "$mode" == "generate" ]]; then
  generate_to "$out_dir"
  exit 0
fi

check_dir="$(mktemp -d)"
generate_to "$check_dir"
diff -u "${out_dir}/branding-inventory-textual.matches.txt" "${check_dir}/branding-inventory-textual.matches.txt"
diff -u "${out_dir}/branding-inventory-platform.matches.txt" "${check_dir}/branding-inventory-platform.matches.txt"
diff -u "${out_dir}/branding-inventory-endpoints-links.matches.txt" "${check_dir}/branding-inventory-endpoints-links.matches.txt"
diff -u "${out_dir}/branding-inventory-visual.files.txt" "${check_dir}/branding-inventory-visual.files.txt"
