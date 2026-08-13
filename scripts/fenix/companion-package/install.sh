#!/usr/bin/env bash
set -euo pipefail

version="__FENIX_CODE_VERSION__"
package_dir="$(cd "$(dirname "$0")" && pwd -P)"
base_dir="${FENIX_CODE_HOME:-${HOME}/.fenix-code}"
version_dir="${base_dir}/runtime/versions/${version}"
node_dir="${base_dir}/runtime/node"
bin_dir="${HOME}/.local/bin"
wrapper_path="${bin_dir}/fenix-code"
version_staging="${base_dir}/runtime/versions/.install-${version}-$$"
node_staging="${base_dir}/runtime/.node-install-$$"
wrapper_staging="${bin_dir}/.fenix-code-install-$$"
version_backup="${base_dir}/runtime/versions/.backup-${version}-$$"
node_backup="${base_dir}/runtime/.node-backup-$$"
wrapper_backup="${bin_dir}/.fenix-code-backup-$$"
version_activated=false
node_activated=false
wrapper_activated=false
install_complete=false

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Este paquete requiere un Mac con Apple Silicon." >&2
  exit 64
fi

for required in \
  "${package_dir}/payload/runtime/node_modules/t3/dist/bin.mjs" \
  "${package_dir}/payload/runtime/node_modules/t3/dist/service-launcher.mjs" \
  "${package_dir}/payload/node/bin/node" \
  "${package_dir}/bin/fenix-code"; do
  if [[ ! -f "$required" ]]; then
    echo "Paquete incompleto: falta ${required#${package_dir}/}." >&2
    exit 65
  fi
done

cleanup() {
  status=$?
  set +e
  if [[ "$install_complete" != true ]]; then
    if [[ -e "$version_backup" ]]; then
      rm -rf "$version_dir"
      mv "$version_backup" "$version_dir"
    elif [[ "$version_activated" == true ]]; then
      rm -rf "$version_dir"
    fi
    if [[ -e "$node_backup" ]]; then
      rm -rf "$node_dir"
      mv "$node_backup" "$node_dir"
    elif [[ "$node_activated" == true ]]; then
      rm -rf "$node_dir"
    fi
    if [[ -e "$wrapper_backup" ]]; then
      rm -f "$wrapper_path"
      mv "$wrapper_backup" "$wrapper_path"
    elif [[ "$wrapper_activated" == true ]]; then
      rm -f "$wrapper_path"
    fi
  fi
  rm -rf "$version_staging" "$node_staging"
  rm -f "$wrapper_staging"
  return "$status"
}
trap cleanup EXIT

mkdir -p "$(dirname "$version_dir")" "$bin_dir"
rm -rf "$version_staging" "$node_staging" "$version_backup" "$node_backup"
rm -f "$wrapper_staging" "$wrapper_backup"
mkdir -p "$version_staging" "$node_staging"
cp -R "${package_dir}/payload/runtime/." "$version_staging/"
printf '%s\n' "$version" > "${version_staging}/.install-complete"
cp -R "${package_dir}/payload/node/." "$node_staging/"
install -m 0755 "${package_dir}/bin/fenix-code" "$wrapper_staging"

staged_version="$(
  "$node_staging/bin/node" "$version_staging/node_modules/t3/dist/bin.mjs" --version
)"
if [[ "$staged_version" != "fenix-code v${version}" ]]; then
  echo "El runtime preparado no supera la verificacion de version." >&2
  exit 65
fi

if [[ -e "$version_dir" ]]; then mv "$version_dir" "$version_backup"; fi
mv "$version_staging" "$version_dir"
version_activated=true
if [[ -e "$node_dir" ]]; then mv "$node_dir" "$node_backup"; fi
mv "$node_staging" "$node_dir"
node_activated=true
if [[ -e "$wrapper_path" ]]; then mv "$wrapper_path" "$wrapper_backup"; fi
mv "$wrapper_staging" "$wrapper_path"
wrapper_activated=true

"$wrapper_path" --version >/dev/null
install_complete=true
rm -rf "$version_backup" "$node_backup"
rm -f "$wrapper_backup"

printf '\nFenix Code Companion %s instalado.\n' "$version"
printf 'Comando: %s\n' "$wrapper_path"
if [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
  printf 'Anade esta linea a ~/.zprofile y abre una Terminal nueva:\n'
  printf '  export PATH="$HOME/.local/bin:$PATH"\n'
fi
printf '\nSiguiente paso: abre la landing Fenix Code, genera el comando de emparejamiento y ejecutalo desde la carpeta que quieras autorizar.\n'
