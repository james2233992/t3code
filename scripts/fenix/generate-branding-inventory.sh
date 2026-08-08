#!/usr/bin/env bash
set -euo pipefail

mode="${1:-check}"
case "$mode" in
  generate | check | selftest) ;;
  *)
    echo "usage: $0 [generate|check|selftest]" >&2
    exit 2
    ;;
esac

repo_root="$(git rev-parse --show-toplevel)"
out_dir="${repo_root}/docs/fenix"
inventory_files=(
  branding-inventory-textual.matches.txt
  branding-inventory-platform.matches.txt
  branding-inventory-endpoints-links.matches.txt
  branding-inventory-visual.files.txt
)

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
  local rg_output
  local rg_status=0
  local jq_status=0
  rg_output="$(mktemp)"
  (
    cd "$repo_root"
    "${FENIX_BRANDING_INVENTORY_RG_BIN:-rg}" --json "${common_rg_args[@]}" -e "$pattern" . \
      > "$rg_output"
  ) || rg_status=$?

  if (( rg_status > 1 )); then
    echo "rg failed with status ${rg_status} while generating branding inventory" >&2
    find "$rg_output" -depth -delete
    return "$rg_status"
  fi

  "${FENIX_BRANDING_INVENTORY_JQ_BIN:-jq}" -r '
    select(.type == "match")
    | .data as $data
    | $data.submatches[]
    | "\($data.path.text):\($data.line_number):\(.start + 1):\(.match.text)"
  ' "$rg_output" | LC_ALL=C sort -u || jq_status=$?
  find "$rg_output" -depth -delete
  return "$jq_status"
}

generate_to() {
  local target_dir="$1"
  mkdir -p "$target_dir"

  run_match_inventory "$textual_pattern" > "${target_dir}/branding-inventory-textual.matches.txt" ||
    return

  run_match_inventory "$platform_pattern" > "${target_dir}/branding-inventory-platform.matches.txt" ||
    return

  run_match_inventory "$endpoint_pattern" \
    > "${target_dir}/branding-inventory-endpoints-links.matches.txt" || return

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
      -not -path 'apps/mobile/deps/*.tgz' \
      | LC_ALL=C sort
  ) > "${target_dir}/branding-inventory-visual.files.txt"
}

write_inventory() {
  local target_dir="$1"
  local staging_dir
  staging_dir="$(mktemp -d)"

  if ! generate_to "$staging_dir"; then
    find "$staging_dir" -depth -delete
    return 1
  fi

  mkdir -p "$target_dir"
  for inventory_file in "${inventory_files[@]}"; do
    install -m 0644 "${staging_dir}/${inventory_file}" "${target_dir}/${inventory_file}"
  done
  find "$staging_dir" -depth -delete
}

run_selftest() {
  local selftest_dir
  local fake_rg
  local fake_jq
  local no_clobber_dir
  selftest_dir="$(mktemp -d)"
  fake_rg="${selftest_dir}/rg"
  fake_jq="${selftest_dir}/jq"

  cat > "$fake_rg" <<'SH'
#!/usr/bin/env bash
exit 1
SH
  chmod +x "$fake_rg"
  export FENIX_BRANDING_INVENTORY_RG_BIN="$fake_rg"
  run_match_inventory "no-match" > "${selftest_dir}/rc1.out"
  test ! -s "${selftest_dir}/rc1.out"

  cat > "$fake_rg" <<'SH'
#!/usr/bin/env bash
echo "synthetic rg failure" >&2
exit 2
SH
  chmod +x "$fake_rg"
  export FENIX_BRANDING_INVENTORY_RG_BIN="$fake_rg"
  if run_match_inventory "error" > "${selftest_dir}/rc2.out" 2> "${selftest_dir}/rc2.err"; then
    echo "expected rg rc>1 to fail" >&2
    find "$selftest_dir" -depth -delete
    return 1
  fi

  no_clobber_dir="${selftest_dir}/out"
  mkdir -p "$no_clobber_dir"
  for inventory_file in "${inventory_files[@]}"; do
    printf 'sentinel:%s\n' "$inventory_file" > "${no_clobber_dir}/${inventory_file}"
  done
  if write_inventory "$no_clobber_dir" > "${selftest_dir}/write.out" \
    2> "${selftest_dir}/write.err"; then
    echo "expected failing generation to preserve existing inventory files" >&2
    find "$selftest_dir" -depth -delete
    return 1
  fi
  for inventory_file in "${inventory_files[@]}"; do
    grep -qx "sentinel:${inventory_file}" "${no_clobber_dir}/${inventory_file}"
  done

  cat > "$fake_rg" <<'SH'
#!/usr/bin/env bash
exit 1
SH
  cat > "$fake_jq" <<'SH'
#!/usr/bin/env bash
echo "synthetic jq failure" >&2
exit 3
SH
  chmod +x "$fake_rg" "$fake_jq"
  export FENIX_BRANDING_INVENTORY_RG_BIN="$fake_rg"
  export FENIX_BRANDING_INVENTORY_JQ_BIN="$fake_jq"
  if run_match_inventory "jq-error" > "${selftest_dir}/jq.out" \
    2> "${selftest_dir}/jq.err"; then
    echo "expected jq failure to fail" >&2
    find "$selftest_dir" -depth -delete
    return 1
  fi
  if write_inventory "$no_clobber_dir" > "${selftest_dir}/jq-write.out" \
    2> "${selftest_dir}/jq-write.err"; then
    echo "expected jq failure to preserve existing inventory files" >&2
    find "$selftest_dir" -depth -delete
    return 1
  fi
  for inventory_file in "${inventory_files[@]}"; do
    grep -qx "sentinel:${inventory_file}" "${no_clobber_dir}/${inventory_file}"
  done

  find "$selftest_dir" -depth -delete
  echo "selftest-pass"
}

if [[ "$mode" == "selftest" ]]; then
  run_selftest
  exit 0
fi

if [[ "$mode" == "generate" ]]; then
  write_inventory "$out_dir"
  exit 0
fi

check_dir="$(mktemp -d)"
trap 'find "$check_dir" -depth -delete' EXIT
generate_to "$check_dir"
diff -u "${out_dir}/branding-inventory-textual.matches.txt" "${check_dir}/branding-inventory-textual.matches.txt"
diff -u "${out_dir}/branding-inventory-platform.matches.txt" "${check_dir}/branding-inventory-platform.matches.txt"
diff -u "${out_dir}/branding-inventory-endpoints-links.matches.txt" "${check_dir}/branding-inventory-endpoints-links.matches.txt"
diff -u "${out_dir}/branding-inventory-visual.files.txt" "${check_dir}/branding-inventory-visual.files.txt"
