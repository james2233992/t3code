#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/fenix-install-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

package_dir="${test_root}/package"
fake_bin="${test_root}/fake-bin"
token_state="${test_root}/used-token"
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
entrypoint="$1"
node_root="$(cd "$(dirname "$0")/.." && pwd -P)"
runtime_root="$(cd "$(dirname "$entrypoint")/../../.." && pwd -P)"
if find "$node_root" "$runtime_root" -name '*.fenix-test-quarantined' -print -quit | grep -q .; then
  echo "quarantine was not cleared before runtime verification" >&2
  exit 78
fi
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

cat > "${fake_bin}/xattr" <<'FAKE_XATTR'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -ne 3 || "$2" != "com.apple.quarantine" ]]; then exit 79; fi
marker="${3}.fenix-test-quarantined"
case "$1" in
  -p) test -e "$marker" ;;
  -d)
    test -e "$marker"
    printf '%s\n' "$3" >> "${FENIX_INSTALL_TEST_XATTR_STATE}"
    unlink "$marker"
    ;;
  *) exit 79 ;;
esac
FAKE_XATTR

cat > "${fake_bin}/uname" <<'FAKE_UNAME'
#!/usr/bin/env bash
if [[ "${1:-}" == "-s" ]]; then printf 'Darwin\n'; else printf 'arm64\n'; fi
FAKE_UNAME
chmod 0755 \
  "${package_dir}/install.sh" \
  "${package_dir}/bin/fenix-code" \
  "${package_dir}/payload/node/bin/node" \
  "${fake_bin}/xattr" \
  "${fake_bin}/uname"

printf 'native fixture\n' > "${package_dir}/payload/runtime/native-addon.node"
printf 'private executable fixture\n' > "${package_dir}/payload/runtime/private-helper"
chmod 0700 "${package_dir}/payload/runtime/private-helper"
touch \
  "${package_dir}/payload/runtime/native-addon.node.fenix-test-quarantined" \
  "${package_dir}/payload/runtime/private-helper.fenix-test-quarantined" \
  "${package_dir}/payload/node/bin/node.fenix-test-quarantined"

run_install() {
  HOME="${test_root}/home" \
  FENIX_CODE_HOME="${test_root}/home/.fenix-code" \
  FENIX_INSTALL_TEST_TOKEN_STATE="$token_state" \
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

run_install \
  --portal https://iaonline.io \
  --attempt-id attempt-1 \
  --pairing-token valid-token \
  --allow-root "$test_root" >/dev/null

config="${test_root}/home/.fenix-code/userdata/fenix-companion.json"
test "$(cat "$config")" = '{"paired":true}'
if mode="$(stat -f '%Lp' "$config" 2>/dev/null)"; then :; else mode="$(stat -c '%a' "$config")"; fi
test "$mode" = "600"
test -x "${test_root}/home/.local/bin/fenix-code"
test "$(wc -l < "$xattr_state" | tr -d ' ')" = "3"
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

printf 'fenix-login-bound-installer-selftest-pass\n'
