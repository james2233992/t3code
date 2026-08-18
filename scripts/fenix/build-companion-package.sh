#!/usr/bin/env bash
set -euo pipefail

target="${1:-macos-arm64}"
if [[ "$target" != "macos-arm64" ]]; then
  echo "usage: $0 macos-arm64" >&2
  exit 64
fi

build_channel="${FENIX_CODE_BUILD_CHANNEL:-official}"
if [[ "$build_channel" != "official" && "$build_channel" != "internal-qa" ]]; then
  echo "invalid companion build channel: $build_channel" >&2
  exit 64
fi
if [[ "$build_channel" == "internal-qa" &&
  "${FENIX_CODE_INTERNAL_QA_ACK:-}" != "MANUEL_INTERNAL_QA_ONLY" ]]; then
  echo "internal QA builds require FENIX_CODE_INTERNAL_QA_ACK=MANUEL_INTERNAL_QA_ONLY" >&2
  exit 78
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

version="$(tr -d '[:space:]' < scripts/fenix/companion-package/VERSION)"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid companion version: $version" >&2
  exit 65
fi
server_version="$(node -p 'require("./apps/server/package.json").version')"
if [[ "$server_version" != "$version" ]]; then
  echo "companion version ${version} does not match server version ${server_version}" >&2
  exit 65
fi
node_version="22.21.1"
opencode_version="1.18.18"
opencode_sha256="4f5979c2dadb06fbff1335335afaaea274e58f92e79aa43cf2ed98618d555422"
if [[ "$build_channel" == "official" ]]; then
  release_label="${FENIX_CODE_RELEASE_LABEL:-${version}-pilot.$(date -u +%Y%m%d)}"
  package_name="Fenix-Code-Companion-${version}-macos-arm64"
  release_dir="${repo_root}/release/fenix-code"
else
  package_name="Fenix-Code-Companion-${version}-internal-qa-macos-arm64"
  release_dir="${repo_root}/release/fenix-code/internal-qa"
fi
public_dir="${repo_root}/apps/web/public/downloads"
archive_path="${release_dir}/${package_name}.tar.gz"

if [[ "$build_channel" == "official" ]]; then
  codesign_identity="${FENIX_CODE_CODESIGN_IDENTITY:-}"
  apple_team_id="${APPLE_TEAM_ID:-}"
  apple_api_key="${APPLE_API_KEY:-}"
  if [[ -z "$codesign_identity" || "$codesign_identity" == "-" ||
    ! "$apple_team_id" =~ ^[A-Z0-9]{10}$ ||
    -z "$apple_api_key" || ! -f "$apple_api_key" ||
    -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER:-}" ]]; then
    echo "Developer ID and Apple notarization credentials are required for an official Companion build" >&2
    exit 78
  fi
fi

required_commands=(node pnpm curl shasum tar file codesign)
if [[ "$build_channel" == "official" ]]; then
  required_commands+=(ln ditto xcrun security)
fi
for command in "${required_commands[@]}"; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing required command: $command" >&2
    exit 69
  }
done

opencode_source="${FENIX_CODE_OPENCODE_SOURCE:-$(command -v opencode || true)}"
if [[ -z "$opencode_source" || ! -f "$opencode_source" || ! -x "$opencode_source" ||
  -L "$opencode_source" ]]; then
  echo "OpenCode ${opencode_version} must be supplied as a regular executable file" >&2
  exit 69
fi
if [[ "$("$opencode_source" --version)" != "$opencode_version" ]] ||
  ! file -b "$opencode_source" | grep -q 'Mach-O 64-bit executable arm64'; then
  echo "the bundled OpenCode engine must be version ${opencode_version} for macOS ARM64" >&2
  exit 65
fi
actual_opencode_sha256="$(shasum -a 256 "$opencode_source" | awk '{ print $1 }')"
if [[ "$actual_opencode_sha256" != "$opencode_sha256" ]]; then
  echo "OpenCode ${opencode_version} checksum verification failed" >&2
  exit 65
fi

if [[ "$build_channel" == "official" ]] &&
  ! security find-identity -v -p codesigning | grep -Fq "$codesign_identity"; then
  echo "FENIX_CODE_CODESIGN_IDENTITY is not available in the current keychain" >&2
  exit 78
fi

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "macos-arm64 packages must be built on an Apple Silicon Mac" >&2
  exit 64
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/fenix-companion.XXXXXX")"
package_dir="${work_dir}/${package_name}"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

pnpm --filter t3 build:bundle >/dev/null
if [[ ! -f apps/server/dist/bin.mjs || ! -f apps/server/dist/service-launcher.mjs ]]; then
  echo "server dist is missing; run pnpm --filter t3 build:bundle first" >&2
  exit 66
fi

mkdir -p "$release_dir" "$package_dir/bin" "$package_dir/payload"
if [[ "$build_channel" == "official" ]]; then
  mkdir -p "$public_dir"
fi

deploy_dir="${work_dir}/deploy"
runtime_dir="${work_dir}/runtime"
isolated_workspace="${work_dir}/workspace"
mkdir -p "$isolated_workspace/apps/server" "$isolated_workspace/patches"
cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$isolated_workspace/"
cp apps/server/package.json "$isolated_workspace/apps/server/"
cp -R apps/server/dist "$isolated_workspace/apps/server/dist"
cp -R patches/. "$isolated_workspace/patches/"
while IFS= read -r -d '' workspace_manifest; do
  isolated_manifest="$isolated_workspace/$workspace_manifest"
  mkdir -p "$(dirname "$isolated_manifest")"
  cp "$workspace_manifest" "$isolated_manifest"
done < <(
  find apps infra packages scripts oxlint-plugin-t3code -name package.json -type f -print0
)

# pnpm deploy changes the install state of the workspace it runs from. Build a
# minimal disposable workspace so packaging can never prune this checkout's
# development dependencies or leave its toolchain unusable.
node - "$isolated_workspace/package.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const rootPackage = JSON.parse(fs.readFileSync(file, "utf8"));
delete rootPackage.scripts;
fs.writeFileSync(file, `${JSON.stringify(rootPackage, null, 2)}\n`);
NODE
(
  cd "$isolated_workspace"
  pnpm --filter t3 deploy --prod --legacy "$deploy_dir" >/dev/null
)

# The provider SDKs publish optional binaries for every supported platform.
# A macOS ARM64 package must not carry Windows, Linux, or Intel macOS payloads.
pnpm_store="${deploy_dir}/node_modules/.pnpm"
while IFS= read -r dependency_dir; do
  find "$dependency_dir" -depth -delete
done < <(
  find "$pnpm_store" -mindepth 1 -maxdepth 1 -type d \( \
    -name '*darwin-x64*' -o \
    -name '*linux-*' -o \
    -name '*win32*' -o \
    -name '*windows*' -o \
    -name '*freebsd*' -o \
    -name '*android*' \
  \) -print
)

# node-pty includes source trees and native builds for other operating systems.
# Keep its runtime JavaScript and the prebuilt Darwin ARM64 binary only.
while IFS= read -r node_pty_dir; do
  for removable in deps scripts src third_party; do
    if [[ -d "${node_pty_dir}/${removable}" ]]; then
      find "${node_pty_dir}/${removable}" -depth -delete
    fi
  done
  if [[ -d "${node_pty_dir}/prebuilds" ]]; then
    find "${node_pty_dir}/prebuilds" -mindepth 1 -maxdepth 1 -type d ! -name 'darwin-arm64' -print0 |
      while IFS= read -r -d '' prebuild_dir; do
        find "$prebuild_dir" -depth -delete
      done
  fi
done < <(find "$pnpm_store" -path '*/node_modules/node-pty' -type d -print)

# Other native packages also nest platform prebuilds below an otherwise
# platform-neutral package. Retain only Darwin ARM64 payloads.
while IFS= read -r -d '' prebuild_root; do
  while IFS= read -r -d '' prebuild_dir; do
    find "$prebuild_dir" -depth -delete
  done < <(
    find "$prebuild_root" -mindepth 1 -maxdepth 1 -type d \
      ! -name 'darwin-arm64' -print0
  )
done < <(find "$pnpm_store" -type d -name prebuilds -print0)

# Pruning optional platform packages can leave pnpm's index symlinks pointing
# at the removed directories. They are not needed on this target and the
# installer rejects unresolved links rather than trusting them.
find "$deploy_dir" -type l ! -exec test -e {} \; -delete

find "$deploy_dir/dist" -type f -name '*.map' -delete
mkdir -p "$runtime_dir/node_modules/t3/dist"
cp -R "${deploy_dir}/node_modules/." "$runtime_dir/node_modules/"
cp -R "${deploy_dir}/dist/." "$runtime_dir/node_modules/t3/dist/"

node - apps/server/package.json "$runtime_dir/node_modules/t3/package.json" "$version" <<'NODE'
const fs = require("node:fs");
const [sourceFile, targetFile, companionVersion] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
const runtimePackage = {
  name: "fenix-code",
  version: companionVersion,
  description: "Fenix Code local companion runtime",
  license: source.license,
  private: true,
  type: source.type,
  bin: { "fenix-code": "./dist/bin.mjs" },
  engines: source.engines,
};
fs.writeFileSync(targetFile, `${JSON.stringify(runtimePackage, null, 2)}\n`);
NODE

node_archive="node-v${node_version}-darwin-arm64.tar.gz"
curl --fail --location --silent --show-error \
  "https://nodejs.org/dist/v${node_version}/${node_archive}" \
  --output "${work_dir}/${node_archive}"
curl --fail --location --silent --show-error \
  "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" \
  --output "${work_dir}/SHASUMS256.txt"
expected_node_sha="$(awk -v file="$node_archive" '$2 == file { print $1 }' "${work_dir}/SHASUMS256.txt")"
actual_node_sha="$(shasum -a 256 "${work_dir}/${node_archive}" | awk '{ print $1 }')"
if [[ -z "$expected_node_sha" || "$actual_node_sha" != "$expected_node_sha" ]]; then
  echo "Node.js runtime checksum verification failed" >&2
  exit 65
fi

node_extract="${work_dir}/node"
mkdir -p "$node_extract"
tar -xzf "${work_dir}/${node_archive}" -C "$node_extract" --strip-components=1

mkdir -p "$package_dir/payload/runtime" "$package_dir/payload/node"
cp -R "${runtime_dir}/." "$package_dir/payload/runtime/"
printf 'Fenix portal authorization required\n' > "$package_dir/payload/runtime/.fenix-portal-auth-required"
mkdir -p "$package_dir/payload/runtime/opencode/bin"
cp "$opencode_source" "$package_dir/payload/runtime/opencode/bin/opencode"
printf '%s\n' "$opencode_version" > "$package_dir/payload/runtime/opencode/VERSION"
cp -R "${node_extract}/." "$package_dir/payload/node/"
cp scripts/fenix/companion-package/install.sh "$package_dir/install.sh"
cp scripts/fenix/companion-package/fenix-code "$package_dir/bin/fenix-code"
if [[ "$build_channel" == "official" ]]; then
  cp scripts/fenix/companion-package/README.txt "$package_dir/README.txt"
else
  cp scripts/fenix/companion-package/README-INTERNAL-QA.txt "$package_dir/README.txt"
fi
sed -i '' "s/__FENIX_CODE_VERSION__/${version}/g" "$package_dir/install.sh" "$package_dir/bin/fenix-code"
if [[ "$build_channel" == "internal-qa" ]]; then
  sed -i '' 's/^package_channel="official"$/package_channel="internal-qa"/' "$package_dir/install.sh"
fi
chmod 0755 \
  "$package_dir/install.sh" \
  "$package_dir/bin/fenix-code" \
  "$package_dir/payload/node/bin/node" \
  "$package_dir/payload/runtime/opencode/bin/opencode"

if [[ "$build_channel" == "official" ]]; then
  scripts/fenix/sign-companion-payload.sh "$package_dir"
else
  scripts/fenix/sign-companion-payload-internal-qa.sh "$package_dir"
fi

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
  } |
    sort -z |
    xargs -0 shasum -a 256 > PAYLOAD-SHA256SUMS
)

smoke_version="$(
  HOME="${work_dir}/smoke-home" \
    FENIX_CODE_HOME="${work_dir}/smoke-home/.fenix-code" \
    "$package_dir/payload/node/bin/node" \
    "$package_dir/payload/runtime/node_modules/t3/dist/bin.mjs" \
    --version
)"
if [[ "$smoke_version" != "fenix-code v${version}" ]]; then
  echo "packaged companion smoke failed: ${smoke_version}" >&2
  exit 65
fi

if [[ "$build_channel" == "internal-qa" ]]; then
  rm -f "$archive_path"
  COPYFILE_DISABLE=1 tar -czf "$archive_path" -C "$work_dir" "$package_name"
  archive_sha="$(shasum -a 256 "$archive_path" | awk '{ print $1 }')"
  archive_size="$(stat -f '%z' "$archive_path")"
  printf '%s  %s\n' "$archive_sha" "$(basename "$archive_path")" > "${archive_path}.sha256"
  printf 'channel=internal-qa\nartifact=%s\nsha256=%s\nsize_bytes=%s\n' \
    "$archive_path" "$archive_sha" "$archive_size"
  exit 0
fi

notarization_output="$(scripts/fenix/notarize-companion-package.sh "$package_dir")"
notarization_id="$(printf '%s\n' "$notarization_output" | awk -F= '$1 == "notarization_id" { print $2 }')"
if [[ -z "$notarization_id" ]]; then
  echo "companion notarization did not return a submission id" >&2
  exit 65
fi

# The official archive is created only after notarization succeeds.
rm -f "$archive_path"
COPYFILE_DISABLE=1 tar -czf "$archive_path" -C "$work_dir" "$package_name"
archive_sha="$(shasum -a 256 "$archive_path" | awk '{ print $1 }')"
archive_size="$(stat -f '%z' "$archive_path")"
rm -f "$public_dir/$(basename "$archive_path")"
ln "$archive_path" "$public_dir/$(basename "$archive_path")"

node - "$public_dir/manifest.json" "$release_label" "$version" "$(basename "$archive_path")" "$archive_sha" "$archive_size" <<'NODE'
const fs = require("node:fs");
const [file, releaseVersion, version, fileName, sha256, sizeBytes] = process.argv.slice(2);
const manifest = {
  schemaVersion: 1,
  releaseVersion,
  artifacts: [
    { platform: "macos", architecture: "arm64", fileName, sha256, sizeBytes: Number(sizeBytes), available: true },
    { platform: "windows", architecture: "x64", fileName: `Fenix-Code-Companion-${version}-windows-x64.zip`, sha256: "0".repeat(64), sizeBytes: 0, available: false },
    { platform: "linux", architecture: "x64", fileName: `Fenix-Code-Companion-${version}-linux-x64.tar.gz`, sha256: "0".repeat(64), sizeBytes: 0, available: false },
  ],
};
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

printf 'artifact=%s\nsha256=%s\nsize_bytes=%s\nnotarization_id=%s\n' \
  "$archive_path" "$archive_sha" "$archive_size" "$notarization_id"
