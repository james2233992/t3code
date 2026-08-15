#!/usr/bin/env bash
set -euo pipefail

package_dir="${1:-}"
api_key="${APPLE_API_KEY:-}"
api_key_id="${APPLE_API_KEY_ID:-}"
api_issuer="${APPLE_API_ISSUER:-}"

if [[ -z "$package_dir" || ! -d "$package_dir" ]]; then
  echo "usage: $0 PACKAGE_DIR" >&2
  exit 64
fi
if [[ ! -f "${package_dir}/payload/SIGNING-METADATA" ]]; then
  echo "companion payload must be signed before notarization" >&2
  exit 65
fi
if [[ -z "$api_key" || ! -f "$api_key" || -z "$api_key_id" || -z "$api_issuer" ]]; then
  echo "APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER are required" >&2
  exit 78
fi

for command in ditto xcrun node; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing required command: $command" >&2
    exit 69
  }
done

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/fenix-companion-notary.XXXXXX")"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

submission_archive="${work_dir}/$(basename "$package_dir").zip"
submission_result="${work_dir}/notary-result.json"
ditto -c -k --keepParent "$package_dir" "$submission_archive"
xcrun notarytool submit "$submission_archive" \
  --key "$api_key" \
  --key-id "$api_key_id" \
  --issuer "$api_issuer" \
  --wait \
  --output-format json > "$submission_result"

notarization_id="$(node - "$submission_result" <<'NODE'
const fs = require("node:fs");
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (result.status !== "Accepted" || typeof result.id !== "string" || result.id.length === 0) {
  process.stderr.write(`Apple notarization was not accepted (status=${String(result.status)}).\n`);
  process.exit(65);
}
process.stdout.write(result.id);
NODE
)"

printf 'notarization_id=%s\n' "$notarization_id"
