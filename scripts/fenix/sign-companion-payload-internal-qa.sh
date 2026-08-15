#!/usr/bin/env bash
set -euo pipefail

package_dir="${1:-}"

if [[ "${FENIX_CODE_INTERNAL_QA_ACK:-}" != "MANUEL_INTERNAL_QA_ONLY" ]]; then
  echo "internal QA signing requires FENIX_CODE_INTERNAL_QA_ACK=MANUEL_INTERNAL_QA_ONLY" >&2
  exit 78
fi
if [[ -z "$package_dir" || ! -d "$package_dir" ]]; then
  echo "usage: $0 PACKAGE_DIR" >&2
  exit 64
fi

for command in codesign file; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing required command: $command" >&2
    exit 69
  }
done

runtime_dir="${package_dir}/payload/runtime"
node_path="${package_dir}/payload/node/bin/node"
if [[ ! -d "$runtime_dir" || ! -f "$node_path" ]]; then
  echo "companion payload is incomplete before internal QA signing" >&2
  exit 66
fi

native_count=0
while IFS= read -r -d '' native_file; do
  if ! file -b "$native_file" | grep -q 'Mach-O'; then
    continue
  fi
  codesign --force --sign - "$native_file"
  codesign --verify --strict --verbose=2 "$native_file"
  native_count=$((native_count + 1))
done < <(find "$runtime_dir" -type f -print0)

if [[ "$native_count" -eq 0 ]]; then
  echo "companion runtime contains no Mach-O native files to sign" >&2
  exit 65
fi

# Node keeps its upstream signature. Only bundled native add-ons receive an
# ad-hoc signature in this explicitly temporary QA channel.
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

cat > "${package_dir}/payload/INTERNAL-QA-METADATA" <<EOF
schema_version=1
channel=internal-qa
native_file_count=${native_count}
EOF

printf 'internal_qa_signed_native_files=%s\n' "$native_count"
