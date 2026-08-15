#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/fenix-companion-security-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

package_dir="${test_root}/Fenix-Code-Companion-9.9.9-macos-arm64"
fake_bin="${test_root}/fake-bin"
codesign_state="${test_root}/codesign-calls"
mkdir -p \
  "${package_dir}/payload/runtime/node_modules/.pnpm/ffi-rs@1.3.2/node_modules/ffi-rs" \
  "${package_dir}/payload/node/bin" \
  "$fake_bin"

printf 'native addon\n' > "${package_dir}/payload/runtime/ffi.node"
printf 'native library\n' > "${package_dir}/payload/runtime/libfff.dylib"
printf 'javascript\n' > \
  "${package_dir}/payload/runtime/node_modules/.pnpm/ffi-rs@1.3.2/node_modules/ffi-rs/index.js"

cat > "${package_dir}/payload/node/bin/node" <<'FAKE_NODE'
#!/usr/bin/env bash
set -euo pipefail
test "${1:-}" = "-e"
test -d "${3:-}"
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
  --force)
    printf 'sign\t%s\n' "$candidate" >> "${FENIX_SIGN_TEST_STATE}"
    ;;
  --verify)
    printf 'verify\t%s\n' "$candidate" >> "${FENIX_SIGN_TEST_STATE}"
    ;;
  -d)
    if [[ "${2:-}" == "--entitlements" ]]; then
      cat <<'EOF'
<plist><dict><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>
EOF
    else
      printf 'TeamIdentifier=%s\n' "${FENIX_SIGN_TEST_ACTUAL_TEAM:-ABCDE12345}" >&2
    fi
    ;;
  *) exit 79 ;;
esac
FAKE_CODESIGN

cat > "${fake_bin}/ditto" <<'FAKE_DITTO'
#!/usr/bin/env bash
set -euo pipefail
touch "${@: -1}"
FAKE_DITTO

cat > "${fake_bin}/xcrun" <<'FAKE_XCRUN'
#!/usr/bin/env bash
set -euo pipefail
printf '{"id":"submission-123","status":"%s"}\n' "${FENIX_NOTARY_TEST_STATUS:-Accepted}"
FAKE_XCRUN

chmod 0755 \
  "${package_dir}/payload/node/bin/node" \
  "${fake_bin}/codesign" \
  "${fake_bin}/ditto" \
  "${fake_bin}/file" \
  "${fake_bin}/xcrun"

sign_output="$(
  PATH="${fake_bin}:${PATH}" \
  FENIX_SIGN_TEST_STATE="$codesign_state" \
  FENIX_CODE_CODESIGN_IDENTITY="Developer ID Application: AIWorks" \
  APPLE_TEAM_ID="ABCDE12345" \
    "${repo_root}/scripts/fenix/sign-companion-payload.sh" "$package_dir"
)"
test "$sign_output" = "signed_native_files=2"
test "$(cat "${package_dir}/payload/SIGNING-METADATA")" = "$(cat <<'EOF'
schema_version=1
team_id=ABCDE12345
native_file_count=2
EOF
)"
test "$(grep -c $'^sign\t' "$codesign_state")" = "2"
grep -Fq $'verify\t'"${package_dir}/payload/runtime/ffi.node" "$codesign_state"
grep -Fq $'verify\t'"${package_dir}/payload/runtime/libfff.dylib" "$codesign_state"
grep -Fq $'verify\t'"${package_dir}/payload/node/bin/node" "$codesign_state"

if PATH="${fake_bin}:${PATH}" APPLE_TEAM_ID="ABCDE12345" \
  "${repo_root}/scripts/fenix/sign-companion-payload.sh" "$package_dir" >/dev/null 2>&1; then
  echo "signing accepted a missing Developer ID identity" >&2
  exit 1
fi

api_key="${test_root}/AuthKey_TEST.p8"
printf 'private test key fixture\n' > "$api_key"
notary_output="$(
  PATH="${fake_bin}:${PATH}" \
  APPLE_API_KEY="$api_key" \
  APPLE_API_KEY_ID="KEY123" \
  APPLE_API_ISSUER="issuer-123" \
    "${repo_root}/scripts/fenix/notarize-companion-package.sh" "$package_dir"
)"
test "$notary_output" = "notarization_id=submission-123"

if PATH="${fake_bin}:${PATH}" \
  FENIX_NOTARY_TEST_STATUS="Invalid" \
  APPLE_API_KEY="$api_key" \
  APPLE_API_KEY_ID="KEY123" \
  APPLE_API_ISSUER="issuer-123" \
    "${repo_root}/scripts/fenix/notarize-companion-package.sh" "$package_dir" \
      >/dev/null 2>&1; then
  echo "notarization accepted an invalid Apple result" >&2
  exit 1
fi

if env -u FENIX_CODE_CODESIGN_IDENTITY -u APPLE_TEAM_ID -u APPLE_API_KEY \
  -u APPLE_API_KEY_ID -u APPLE_API_ISSUER \
  bash "${repo_root}/scripts/fenix/build-companion-package.sh" macos-arm64 \
    >/dev/null 2>&1; then
  echo "official build accepted missing Apple release credentials" >&2
  exit 1
fi

printf 'fenix-companion-release-security-selftest-pass\n'
