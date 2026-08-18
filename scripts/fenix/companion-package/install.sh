#!/usr/bin/env bash
set -euo pipefail

version="__FENIX_CODE_VERSION__"
package_channel="official"
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
accept_internal_qa=false

usage() {
  if [[ "$package_channel" == "internal-qa" ]]; then
    echo "Uso: ./install.sh --accept-unnotarized-internal-qa --portal URL --attempt-id ID --pairing-token TOKEN --allow-root RUTA" >&2
  else
    echo "Uso: ./install.sh --portal URL --attempt-id ID --pairing-token TOKEN --allow-root RUTA" >&2
  fi
  echo >&2
  echo "Genera este comando desde https://iaonline.io/code-lab/setup tras iniciar sesión." >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --accept-unnotarized-internal-qa)
      accept_internal_qa=true
      shift
      ;;
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

if [[ "$package_channel" != "official" && "$package_channel" != "internal-qa" ]]; then
  echo "El paquete declara un canal de distribución desconocido." >&2
  exit 65
fi
if [[ "$package_channel" == "internal-qa" && "$accept_internal_qa" != true ]]; then
  echo "Este paquete temporal no está notarizado. Requiere --accept-unnotarized-internal-qa." >&2
  exit 64
fi
if [[ "$package_channel" == "official" && "$accept_internal_qa" == true ]]; then
  echo "La aceptación temporal de QA no es válida para un paquete oficial." >&2
  exit 64
fi

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

required_files=( \
  "${package_dir}/payload/runtime/node_modules/t3/dist/bin.mjs" \
  "${package_dir}/payload/runtime/node_modules/t3/dist/service-launcher.mjs" \
  "${package_dir}/payload/runtime/.fenix-portal-auth-required" \
  "${package_dir}/payload/runtime/opencode/bin/opencode" \
  "${package_dir}/payload/runtime/opencode/VERSION" \
  "${package_dir}/payload/node/bin/node" \
  "${package_dir}/bin/fenix-code" \
  "${package_dir}/PAYLOAD-SYMLINKS" \
  "${package_dir}/PAYLOAD-SHA256SUMS"
)
if [[ "$package_channel" == "official" ]]; then
  required_files+=("${package_dir}/payload/SIGNING-METADATA")
else
  required_files+=("${package_dir}/payload/INTERNAL-QA-METADATA")
fi
for required in "${required_files[@]}"; do
  if [[ ! -f "$required" ]]; then
    echo "Paquete incompleto: falta ${required#${package_dir}/}." >&2
    exit 65
  fi
done

required_commands=(codesign diff file readlink realpath)
if [[ "$package_channel" == "internal-qa" ]]; then
  required_commands+=(xattr)
fi
for command in "${required_commands[@]}"; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "macOS no dispone de la herramienta de verificación ${command}." >&2
    exit 69
  }
done

while IFS= read -r -d '' link_path; do
  link_target="$(readlink "$link_path")"
  if [[ "$link_target" == /* ]]; then
    echo "El paquete contiene un enlace simbólico absoluto no permitido." >&2
    exit 65
  fi
  if ! resolved_link="$(realpath "$link_path" 2>/dev/null)" ||
    [[ "$resolved_link" != "${package_dir}/"* ]]; then
    echo "El paquete contiene un enlace simbólico que sale de su contenido." >&2
    exit 65
  fi
done < <(find "${package_dir}/bin" "${package_dir}/payload" -type l -print0)

if ! (cd "$package_dir" && shasum -a 256 -c PAYLOAD-SHA256SUMS >/dev/null 2>&1); then
  echo "El paquete no supera la verificación interna de integridad." >&2
  exit 65
fi
if ! diff -u "${package_dir}/PAYLOAD-SYMLINKS" <(
  cd "$package_dir"
  find bin payload -type l -print0 |
    sort -z |
    while IFS= read -r -d '' link_path; do
      printf '%s\t%s\n' "$link_path" "$(readlink "$link_path")"
    done
) >/dev/null; then
  echo "El inventario de enlaces simbólicos del paquete no coincide." >&2
  exit 65
fi

if [[ "$package_channel" == "official" ]]; then
  metadata_path="${package_dir}/payload/SIGNING-METADATA"
  signing_team="$(awk -F= '$1 == "team_id" { print $2 }' "$metadata_path")"
  expected_channel=""
else
  metadata_path="${package_dir}/payload/INTERNAL-QA-METADATA"
  signing_team=""
  expected_channel="$(awk -F= '$1 == "channel" { print $2 }' "$metadata_path")"
fi
expected_native_count="$(
  awk -F= '$1 == "native_file_count" { print $2 }' "$metadata_path"
)"
if [[ ! "$expected_native_count" =~ ^[1-9][0-9]*$ ]] ||
  { [[ "$package_channel" == "official" ]] && [[ ! "$signing_team" =~ ^[A-Z0-9]{10}$ ]]; } ||
  { [[ "$package_channel" == "internal-qa" ]] && [[ "$expected_channel" != "internal-qa" ]]; }; then
  echo "El paquete no contiene metadatos de firma válidos." >&2
  exit 65
fi

native_count=0
while IFS= read -r -d '' native_file; do
  if ! file -b "$native_file" | grep -q 'Mach-O'; then
    continue
  fi
  if ! codesign --verify --strict --verbose=2 "$native_file"; then
    echo "El paquete contiene un componente nativo sin firma válida (${native_file#${package_dir}/})." >&2
    exit 65
  fi
  if [[ "$package_channel" == "official" ]]; then
    actual_team="$(
      codesign -d --verbose=4 "$native_file" 2>&1 |
        awk -F= '$1 == "TeamIdentifier" { print $2 }'
    )"
    if [[ "$actual_team" != "$signing_team" ]]; then
      echo "El paquete contiene un componente nativo firmado por otro equipo (${native_file#${package_dir}/})." >&2
      exit 65
    fi
  fi
  native_count=$((native_count + 1))
done < <(find "${package_dir}/payload/runtime" -type f -print0)

if [[ "$native_count" != "$expected_native_count" ]]; then
  echo "El inventario de componentes nativos del paquete no coincide con su firma." >&2
  exit 65
fi
if ! codesign --verify --strict --verbose=2 "${package_dir}/payload/node/bin/node"; then
  echo "El runtime Node.js del paquete no conserva una firma válida." >&2
  exit 65
fi

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

if [[ "$package_channel" == "internal-qa" ]]; then
  while IFS= read -r -d '' staged_file; do
    if [[ -x "$staged_file" ]] || file -b "$staged_file" | grep -q 'Mach-O'; then
      if xattr -p com.apple.quarantine "$staged_file" >/dev/null 2>&1; then
        if ! xattr -d com.apple.quarantine "$staged_file"; then
          echo "No se pudo retirar la cuarentena del componente verificado ${staged_file#${base_dir}/}." >&2
          exit 65
        fi
      fi
    fi
  done < <(find "$version_staging" "$node_staging" -type f -print0)
  if xattr -p com.apple.quarantine "$wrapper_staging" >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "$wrapper_staging"
  fi
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
opencode_version="$(tr -d '[:space:]' < "${version_staging}/opencode/VERSION")"
if [[ ! "$opencode_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  [[ "$("${version_staging}/opencode/bin/opencode" --version)" != "$opencode_version" ]]; then
  echo "El motor local OpenCode no supera la verificación de versión." >&2
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

if [[ "$package_channel" == "internal-qa" ]]; then
  printf '\nFenix Code Companion %s instalado para QA interno temporal (no notarizado).\n' "$version"
else
  printf '\nFenix Code Companion %s instalado.\n' "$version"
fi
printf 'Comando: %s\n' "$wrapper_path"
if [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
  printf 'Añade esta línea a ~/.zprofile y abre una Terminal nueva:\n'
  printf '  export PATH="$HOME/.local/bin:$PATH"\n'
fi
printf '\nEquipo autorizado por Fenix. Siguiente paso: ejecuta fenix-code service install.\n'
