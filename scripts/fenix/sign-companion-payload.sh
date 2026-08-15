#!/usr/bin/env bash
set -euo pipefail

package_dir="${1:-}"
identity="${FENIX_CODE_CODESIGN_IDENTITY:-}"
team_id="${APPLE_TEAM_ID:-}"

if [[ -z "$package_dir" || ! -d "$package_dir" ]]; then
  echo "usage: $0 PACKAGE_DIR" >&2
  exit 64
fi
if [[ -z "$identity" || "$identity" == "-" ]]; then
  echo "FENIX_CODE_CODESIGN_IDENTITY must name a Developer ID Application identity" >&2
  exit 78
fi
if [[ ! "$team_id" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "APPLE_TEAM_ID must be a 10-character Apple Developer Team ID" >&2
  exit 78
fi

for command in codesign file node; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing required command: $command" >&2
    exit 69
  }
done

runtime_dir="${package_dir}/payload/runtime"
node_path="${package_dir}/payload/node/bin/node"
if [[ ! -d "$runtime_dir" || ! -f "$node_path" ]]; then
  echo "companion payload is incomplete before signing" >&2
  exit 66
fi

native_count=0
while IFS= read -r -d '' native_file; do
  if ! file -b "$native_file" | grep -q 'Mach-O'; then
    continue
  fi

  codesign --force --sign "$identity" --timestamp --options runtime "$native_file"
  codesign --verify --strict --verbose=2 "$native_file"
  actual_team="$(
    codesign -d --verbose=4 "$native_file" 2>&1 |
      awk -F= '$1 == "TeamIdentifier" { print $2 }'
  )"
  if [[ "$actual_team" != "$team_id" ]]; then
    echo "signed runtime file has unexpected TeamIdentifier: ${native_file#${package_dir}/}" >&2
    exit 65
  fi
  native_count=$((native_count + 1))
done < <(find "$runtime_dir" -type f -print0)

if [[ "$native_count" -eq 0 ]]; then
  echo "companion runtime contains no Mach-O native files to sign" >&2
  exit 65
fi

# Keep the upstream Node.js Foundation signature intact and prove that its
# hardened runtime can load the newly signed ffi-rs module.
codesign --verify --strict --verbose=2 "$node_path"
node_entitlements="$(codesign -d --entitlements - "$node_path" 2>/dev/null)"
if [[ "$node_entitlements" != *"com.apple.security.cs.disable-library-validation"* ]]; then
  echo "packaged Node.js runtime does not allow signed native addons" >&2
  exit 65
fi

ffi_module="$(
  find "$runtime_dir/node_modules" -path '*/node_modules/ffi-rs' -type d -print -quit
)"
if [[ -z "$ffi_module" ]]; then
  echo "packaged ffi-rs runtime is missing" >&2
  exit 66
fi
"$node_path" -e 'require(process.argv[1])' "$ffi_module"

cat > "${package_dir}/payload/SIGNING-METADATA" <<EOF
schema_version=1
team_id=${team_id}
native_file_count=${native_count}
EOF

printf 'signed_native_files=%s\n' "$native_count"
