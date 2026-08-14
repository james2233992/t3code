#!/usr/bin/env bash
set -euo pipefail

target="${1:-macos-arm64}"
if [[ "$target" != "macos-arm64" ]]; then
  echo "usage: $0 macos-arm64" >&2
  exit 64
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

version="$(node -p 'require("./apps/server/package.json").version')"
node_version="22.21.1"
package_name="Fenix-Code-Companion-${version}-macos-arm64"
release_dir="${repo_root}/release/fenix-code"
public_dir="${repo_root}/apps/web/public/downloads"
archive_path="${release_dir}/${package_name}.tar.gz"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/fenix-companion.XXXXXX")"
package_dir="${work_dir}/${package_name}"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

for command in node pnpm curl shasum tar ln; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing required command: $command" >&2
    exit 69
  }
done

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "macos-arm64 packages must be built on an Apple Silicon Mac" >&2
  exit 64
fi

pnpm --filter t3 build:bundle >/dev/null
if [[ ! -f apps/server/dist/bin.mjs || ! -f apps/server/dist/service-launcher.mjs ]]; then
  echo "server dist is missing; run pnpm --filter t3 build:bundle first" >&2
  exit 66
fi

mkdir -p "$release_dir" "$public_dir" "$package_dir/bin" "$package_dir/payload"

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

find "$deploy_dir/dist" -type f -name '*.map' -delete
mkdir -p "$runtime_dir/node_modules/t3/dist"
cp -R "${deploy_dir}/node_modules/." "$runtime_dir/node_modules/"
cp -R "${deploy_dir}/dist/." "$runtime_dir/node_modules/t3/dist/"

node - apps/server/package.json "$runtime_dir/node_modules/t3/package.json" <<'NODE'
const fs = require("node:fs");
const [sourceFile, targetFile] = process.argv.slice(2);
const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
const runtimePackage = {
  name: "fenix-code",
  version: source.version,
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
cp -R "${node_extract}/." "$package_dir/payload/node/"
cp scripts/fenix/companion-package/install.sh "$package_dir/install.sh"
cp scripts/fenix/companion-package/fenix-code "$package_dir/bin/fenix-code"
cp scripts/fenix/companion-package/README.txt "$package_dir/README.txt"
sed -i '' "s/__FENIX_CODE_VERSION__/${version}/g" "$package_dir/install.sh" "$package_dir/bin/fenix-code"
chmod 0755 "$package_dir/install.sh" "$package_dir/bin/fenix-code" "$package_dir/payload/node/bin/node"

(
  cd "$package_dir"
  find bin payload -type f -print0 |
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

rm -f "$archive_path"
COPYFILE_DISABLE=1 tar -czf "$archive_path" -C "$work_dir" "$package_name"
archive_sha="$(shasum -a 256 "$archive_path" | awk '{ print $1 }')"
archive_size="$(stat -f '%z' "$archive_path")"
rm -f "$public_dir/$(basename "$archive_path")"
ln "$archive_path" "$public_dir/$(basename "$archive_path")"

node - "$public_dir/manifest.json" "$version" "$(basename "$archive_path")" "$archive_sha" "$archive_size" <<'NODE'
const fs = require("node:fs");
const [file, version, fileName, sha256, sizeBytes] = process.argv.slice(2);
const manifest = {
  schemaVersion: 1,
  releaseVersion: `${version}-pilot.20260814`,
  artifacts: [
    { platform: "macos", architecture: "arm64", fileName, sha256, sizeBytes: Number(sizeBytes), available: true },
    { platform: "windows", architecture: "x64", fileName: `Fenix-Code-Companion-${version}-windows-x64.zip`, sha256: "0".repeat(64), sizeBytes: 0, available: false },
    { platform: "linux", architecture: "x64", fileName: `Fenix-Code-Companion-${version}-linux-x64.tar.gz`, sha256: "0".repeat(64), sizeBytes: 0, available: false },
  ],
};
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

printf 'artifact=%s\nsha256=%s\nsize_bytes=%s\n' "$archive_path" "$archive_sha" "$archive_size"
