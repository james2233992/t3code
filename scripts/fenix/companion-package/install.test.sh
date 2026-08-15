#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/fenix-install-test.XXXXXX")"
test_root="$(cd "$test_root" && pwd -P)"
trap 'rm -rf "$test_root"' EXIT

package_dir="${test_root}/package"
fake_bin="${test_root}/fake-bin"
token_state="${test_root}/used-token"
codesign_state="${test_root}/codesign-calls"
xattr_state="${test_root}/xattr-calls"
mkdir -p \
  "${package_dir}/payload/runtime/node_modules/t3/dist" \
  "${package_dir}/payload/node/bin" \
  "${package_dir}/bin" \
  "$fake_bin"

sed 's/__FENIX_CODE_VERSION__/1.2.3/g' \
  "${repo_root}/scripts/fenix/companion-package/install.sh" > "${package_dir}/install.sh"
sed 's/__FENIX_CODE_VERSION__/1.2.3/g' \
  "${repo_root}/scripts/fenix/companion-package/fenix-code" > "${package_dir}/bin/fenix-code"
printf 'export {};\n' > "${package_dir}/payload/runtime/node_modules/t3/dist/bin.mjs"
printf 'export {};\n' > "${package_dir}/payload/runtime/node_modules/t3/dist/service-launcher.mjs"
printf 'Fenix portal authorization required\n' > "${package_dir}/payload/runtime/.fenix-portal-auth-required"

cat > "${package_dir}/payload/node/bin/node" <<'FAKE_NODE'
#!/usr/bin/env bash
set -euo pipefail
shift
if [[ "${1:-}" == "--version" ]]; then
  printf 'fenix-code v1.2.3\n'
  exit 0
fi
if [[ "${1:-}" != "fenix" || "${2:-}" != "pair" ]]; then
  exit 65
fi
shift 2
base_dir=""
token=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-dir) base_dir="$2"; shift 2 ;;
    --pairing-token) token="$2"; shift 2 ;;
    *) shift 2 ;;
  esac
done
if [[ "$token" != "valid-token" || -e "${FENIX_INSTALL_TEST_TOKEN_STATE}" ]]; then
  exit 77
fi
touch "${FENIX_INSTALL_TEST_TOKEN_STATE}"
mkdir -p "${base_dir}/userdata"
printf '{"paired":true}\n' > "${base_dir}/userdata/fenix-companion.json"
chmod 0600 "${base_dir}/userdata/fenix-companion.json"
FAKE_NODE

cat > "${fake_bin}/file" <<'FAKE_FILE'
#!/usr/bin/env bash
set -euo pipefail
candidate="${@: -1}"
case "$candidate" in
  *.node|*.dylib) printf 'Mach-O 64-bit bundle arm64\n' ;;
  *) printf 'ASCII text\n' ;;
esac
FAKE_FILE

cat > "${fake_bin}/codesign" <<'FAKE_CODESIGN'
#!/usr/bin/env bash
set -euo pipefail
candidate="${@: -1}"
case "${1:-}" in
  --verify)
    printf 'verify\t%s\n' "$candidate" >> "${FENIX_INSTALL_TEST_CODESIGN_STATE}"
    ;;
  -d)
    printf 'TeamIdentifier=ABCDE12345\n' >&2
    ;;
  *) exit 79 ;;
esac
FAKE_CODESIGN

cat > "${fake_bin}/uname" <<'FAKE_UNAME'
#!/usr/bin/env bash
if [[ "${1:-}" == "-s" ]]; then printf 'Darwin\n'; else printf 'arm64\n'; fi
FAKE_UNAME
cat > "${fake_bin}/xattr" <<'FAKE_XATTR'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -p) exit 0 ;;
  -d) printf 'clear\t%s\n' "${@: -1}" >> "${FENIX_INSTALL_TEST_XATTR_STATE}" ;;
  *) exit 79 ;;
esac
FAKE_XATTR
chmod 0755 \
  "${package_dir}/install.sh" \
  "${package_dir}/bin/fenix-code" \
  "${package_dir}/payload/node/bin/node" \
  "${fake_bin}/codesign" \
  "${fake_bin}/file" \
  "${fake_bin}/uname" \
  "${fake_bin}/xattr"

printf 'native fixture\n' > "${package_dir}/payload/runtime/native-addon.node"
printf 'native library fixture\n' > "${package_dir}/payload/runtime/native-library.dylib"
cat > "${package_dir}/payload/SIGNING-METADATA" <<'EOF'
schema_version=1
team_id=ABCDE12345
native_file_count=2
EOF

refresh_checksums() {
  (
    cd "$package_dir"
    find bin payload -type l -print0 |
      sort -z |
      while IFS= read -r -d '' link_path; do
        printf '%s\t%s\n' "$link_path" "$(readlink "$link_path")"
      done > PAYLOAD-SYMLINKS
    {
      find bin payload -type f -print0
      printf 'PAYLOAD-SYMLINKS\0'
    } | sort -z | xargs -0 shasum -a 256 > PAYLOAD-SHA256SUMS
  )
}
refresh_checksums

run_install() {
  HOME="${test_root}/home" \
  FENIX_CODE_HOME="${test_root}/home/.fenix-code" \
  FENIX_INSTALL_TEST_TOKEN_STATE="$token_state" \
  FENIX_INSTALL_TEST_CODESIGN_STATE="$codesign_state" \
  FENIX_INSTALL_TEST_XATTR_STATE="$xattr_state" \
  PATH="${fake_bin}:${PATH}" \
    "${package_dir}/install.sh" "$@"
}

if run_install >/dev/null 2>&1; then
  echo "installer accepted a missing Fenix authorization" >&2
  exit 1
fi
test ! -e "${test_root}/home/.fenix-code"

if run_install \
  --portal https://example.invalid \
  --attempt-id attempt-1 \
  --pairing-token valid-token \
  --allow-root "$test_root" >/dev/null 2>&1; then
  echo "installer accepted an authorization from an untrusted portal" >&2
  exit 1
fi
test ! -e "${test_root}/home/.fenix-code"

printf 'tampered\n' >> "${package_dir}/payload/runtime/node_modules/t3/dist/service-launcher.mjs"
if integrity_output="$(
  run_install \
    --portal https://iaonline.io \
    --attempt-id attempt-integrity \
    --pairing-token valid-token \
    --allow-root "$test_root" 2>&1
)"; then
  echo "installer accepted a modified payload" >&2
  exit 1
fi
test "${integrity_output##*$'\n'}" = "El paquete no supera la verificación interna de integridad."
printf 'export {};\n' > "${package_dir}/payload/runtime/node_modules/t3/dist/service-launcher.mjs"

ln -s /tmp "${package_dir}/payload/runtime/unsafe-link"
refresh_checksums
if run_install \
  --portal https://iaonline.io \
  --attempt-id attempt-unsafe-link \
  --pairing-token valid-token \
  --allow-root "$test_root" >/dev/null 2>&1; then
  echo "installer accepted an absolute package symlink" >&2
  exit 1
fi
rm "${package_dir}/payload/runtime/unsafe-link"

sed 's/team_id=ABCDE12345/team_id=ZZZZZ99999/' \
  "${package_dir}/payload/SIGNING-METADATA" > "${package_dir}/payload/SIGNING-METADATA.next"
mv "${package_dir}/payload/SIGNING-METADATA.next" \
  "${package_dir}/payload/SIGNING-METADATA"
refresh_checksums
if signing_output="$(
  run_install \
    --portal https://iaonline.io \
    --attempt-id attempt-signing-team \
    --pairing-token valid-token \
    --allow-root "$test_root" 2>&1
)"; then
  echo "installer accepted a payload signed by another team" >&2
  exit 1
fi
test "${signing_output##*$'\n'}" = \
  "El paquete contiene un componente nativo firmado por otro equipo (payload/runtime/native-addon.node)."
sed 's/team_id=ZZZZZ99999/team_id=ABCDE12345/' \
  "${package_dir}/payload/SIGNING-METADATA" > "${package_dir}/payload/SIGNING-METADATA.next"
mv "${package_dir}/payload/SIGNING-METADATA.next" \
  "${package_dir}/payload/SIGNING-METADATA"
refresh_checksums

if ! install_output="$(
  run_install \
    --portal https://iaonline.io \
    --attempt-id attempt-1 \
    --pairing-token valid-token \
    --allow-root "$test_root" 2>&1
)"; then
  echo "installer rejected a valid signed payload: ${install_output}" >&2
  exit 1
fi

config="${test_root}/home/.fenix-code/userdata/fenix-companion.json"
test "$(cat "$config")" = '{"paired":true}'
if mode="$(stat -f '%Lp' "$config" 2>/dev/null)"; then :; else mode="$(stat -c '%a' "$config")"; fi
test "$mode" = "600"
test -x "${test_root}/home/.local/bin/fenix-code"
for verified_file in \
  "${package_dir}/payload/runtime/native-addon.node" \
  "${package_dir}/payload/runtime/native-library.dylib" \
  "${package_dir}/payload/node/bin/node"; do
  if ! grep -Fq $'verify\t'"$verified_file" "$codesign_state"; then
    echo "installer did not verify expected signature: $verified_file" >&2
    cat "$codesign_state" >&2
    exit 1
  fi
done
before_sha="$(shasum -a 256 "$config" | awk '{print $1}')"

if run_install \
  --portal https://iaonline.io \
  --attempt-id attempt-1 \
  --pairing-token valid-token \
  --allow-root "$test_root" >/dev/null 2>&1; then
  echo "installer reused a consumed Fenix authorization" >&2
  exit 1
fi
after_sha="$(shasum -a 256 "$config" | awk '{print $1}')"
test "$before_sha" = "$after_sha"

rm -f "$config"
ln -s "${test_root}/outside-config" "$config"
if run_install \
  --portal https://iaonline.io \
  --attempt-id attempt-2 \
  --pairing-token consumed-token \
  --allow-root "$test_root" >/dev/null 2>&1; then
  echo "installer accepted an unsafe existing config" >&2
  exit 1
fi
test -L "$config"
test "$(readlink "$config")" = "${test_root}/outside-config"

rm -rf "${test_root}/home"
rm -f "$token_state" "$codesign_state" "$xattr_state"
sed -e 's/__FENIX_CODE_VERSION__/1.2.3/g' \
  -e 's/^package_channel="official"$/package_channel="internal-qa"/' \
  "${repo_root}/scripts/fenix/companion-package/install.sh" > "${package_dir}/install.sh"
chmod 0755 "${package_dir}/install.sh"
rm -f "${package_dir}/payload/SIGNING-METADATA"
cat > "${package_dir}/payload/INTERNAL-QA-METADATA" <<'EOF'
schema_version=1
channel=internal-qa
native_file_count=2
EOF
refresh_checksums

if run_install \
  --portal https://iaonline.io \
  --attempt-id attempt-internal-no-ack \
  --pairing-token valid-token \
  --allow-root "$test_root" >/dev/null 2>&1; then
  echo "internal QA installer accepted a missing explicit acknowledgement" >&2
  exit 1
fi
test ! -e "${test_root}/home/.fenix-code"

printf 'tampered\n' >> "${package_dir}/payload/runtime/native-addon.node"
if run_install \
  --accept-unnotarized-internal-qa \
  --portal https://iaonline.io \
  --attempt-id attempt-internal-tampered \
  --pairing-token valid-token \
  --allow-root "$test_root" >/dev/null 2>&1; then
  echo "internal QA installer accepted a modified payload" >&2
  exit 1
fi
test ! -e "$xattr_state"
printf 'native fixture\n' > "${package_dir}/payload/runtime/native-addon.node"
refresh_checksums

if ! internal_output="$(
  run_install \
    --accept-unnotarized-internal-qa \
    --portal https://iaonline.io \
    --attempt-id attempt-internal \
    --pairing-token valid-token \
    --allow-root "$test_root" 2>&1
)"; then
  echo "internal QA installer rejected a valid temporary payload: ${internal_output}" >&2
  exit 1
fi
grep -Fq 'QA interno temporal (no notarizado)' <<<"$internal_output"
grep -Fq $'clear\t'"${test_root}/home/.fenix-code/runtime/versions/.install-1.2.3-" "$xattr_state"
test "$(cat "${test_root}/home/.fenix-code/userdata/fenix-companion.json")" = '{"paired":true}'

printf 'fenix-login-bound-installer-selftest-pass\n'
