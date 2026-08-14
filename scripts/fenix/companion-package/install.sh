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
config_path="${base_dir}/userdata/fenix-companion.json"
config_backup="${base_dir}/userdata/.fenix-companion-backup-$$"
version_activated=false
node_activated=false
wrapper_activated=false
config_existed=false
config_was_present=false
install_complete=false
portal=""
attempt_id=""
pairing_token=""
allow_root=""

usage() {
  cat >&2 <<'EOF'
Uso: ./install.sh --portal URL --attempt-id ID --pairing-token TOKEN --allow-root RUTA

Genera este comando desde https://iaonline.io/code-lab/setup tras iniciar sesión.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --portal|--attempt-id|--pairing-token|--allow-root)
      if [[ $# -lt 2 || -z "$2" ]]; then
        usage
        exit 64
      fi
      case "$1" in
        --portal) portal="$2" ;;
        --attempt-id) attempt_id="$2" ;;
        --pairing-token) pairing_token="$2" ;;
        --allow-root) allow_root="$2" ;;
      esac
      shift 2
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

if [[ -z "$portal" || -z "$attempt_id" || -z "$pairing_token" || -z "$allow_root" ]]; then
  echo "La instalación requiere una autorización de un solo uso emitida por Fenix." >&2
  usage
  exit 64
fi

portal="${portal%/}"
if [[ "$portal" != "https://iaonline.io" ]]; then
  echo "Este paquete oficial solo acepta autorizaciones emitidas por https://iaonline.io." >&2
  exit 64
fi

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Este paquete requiere un Mac con Apple Silicon." >&2
  exit 64
fi

for required in \
  "${package_dir}/payload/runtime/node_modules/t3/dist/bin.mjs" \
  "${package_dir}/payload/runtime/node_modules/t3/dist/service-launcher.mjs" \
  "${package_dir}/payload/runtime/.fenix-portal-auth-required" \
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
    if [[ "$config_existed" == true && -f "$config_backup" ]]; then
      rm -f "$config_path"
      mv "$config_backup" "$config_path"
    elif [[ "$config_was_present" == false ]]; then
      rm -f "$config_path"
    fi
  fi
  rm -rf "$version_staging" "$node_staging"
  rm -f "$wrapper_staging" "$config_backup"
  return "$status"
}
trap cleanup EXIT

mkdir -p "$(dirname "$version_dir")" "$bin_dir"
mkdir -p "$(dirname "$config_path")"
chmod 0700 "$(dirname "$config_path")"
rm -rf "$version_staging" "$node_staging" "$version_backup" "$node_backup"
rm -f "$wrapper_staging" "$wrapper_backup" "$config_backup"
mkdir -p "$version_staging" "$node_staging"
cp -R "${package_dir}/payload/runtime/." "$version_staging/"
printf '%s\n' "$version" > "${version_staging}/.install-complete"
cp -R "${package_dir}/payload/node/." "$node_staging/"
install -m 0755 "${package_dir}/bin/fenix-code" "$wrapper_staging"

# Browser downloads inherit macOS quarantine on extracted executables and
# native addons. Inspect regular runtime files only: the pnpm payload contains
# optional dangling symlinks that make recursive xattr fail even when every
# executable was cleared correctly.
if command -v xattr >/dev/null 2>&1; then
  while IFS= read -r -d '' runtime_file; do
    if [[ ! -x "$runtime_file" && \
      "$runtime_file" != *.node && \
      "$runtime_file" != *.dylib && \
      "$runtime_file" != *.so ]]; then
      continue
    fi
    if xattr -p com.apple.quarantine "$runtime_file" >/dev/null 2>&1; then
      if ! xattr -d com.apple.quarantine "$runtime_file"; then
        runtime_label="${runtime_file#${version_staging}/}"
        if [[ "$runtime_label" == "$runtime_file" ]]; then
          runtime_label="node/${runtime_file#${node_staging}/}"
        fi
        echo "macOS no pudo autorizar el runtime local de Fenix Code (${runtime_label})." >&2
        exit 65
      fi
    fi
  done < <(
    find "$version_staging" "$node_staging" -type f -print0
  )
fi

staged_version="$(
  "$node_staging/bin/node" "$version_staging/node_modules/t3/dist/bin.mjs" --version
)"
if [[ "$staged_version" != "fenix-code v${version}" ]]; then
  echo "El runtime preparado no supera la verificación de versión." >&2
  exit 65
fi
if [[ "$(cat "${version_staging}/.fenix-portal-auth-required")" != "Fenix portal authorization required" ]]; then
  echo "El paquete no contiene el marcador obligatorio de autorización Fenix." >&2
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

if [[ -e "$config_path" || -L "$config_path" ]]; then
  config_was_present=true
  if [[ ! -f "$config_path" || -L "$config_path" ]]; then
    echo "La configuración Fenix existente no es un fichero regular seguro." >&2
    exit 65
  fi
  cp -p "$config_path" "$config_backup"
  config_existed=true
fi

"$wrapper_path" fenix pair \
  --portal "$portal" \
  --attempt-id "$attempt_id" \
  --pairing-token "$pairing_token" \
  --allow-root "$allow_root" \
  --base-dir "$base_dir"
pairing_token=""

if [[ ! -f "$config_path" || -L "$config_path" ]]; then
  echo "Fenix no generó una credencial de dispositivo válida." >&2
  exit 65
fi
if config_mode="$(stat -f '%Lp' "$config_path" 2>/dev/null)"; then
  :
else
  config_mode="$(stat -c '%a' "$config_path")"
fi
if [[ "$config_mode" != "600" ]]; then
  echo "La credencial local no tiene permisos 0600." >&2
  exit 65
fi

install_complete=true
rm -rf "$version_backup" "$node_backup"
rm -f "$wrapper_backup" "$config_backup"

printf '\nFenix Code Companion %s instalado.\n' "$version"
printf 'Comando: %s\n' "$wrapper_path"
if [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
  printf 'Añade esta línea a ~/.zprofile y abre una Terminal nueva:\n'
  printf '  export PATH="$HOME/.local/bin:$PATH"\n'
fi
printf '\nEquipo autorizado por Fenix. Siguiente paso: ejecuta fenix-code service install.\n'
