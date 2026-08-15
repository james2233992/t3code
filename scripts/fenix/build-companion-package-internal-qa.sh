#!/usr/bin/env bash
set -euo pipefail

if [[ "${FENIX_CODE_INTERNAL_QA_ACK:-}" != "MANUEL_INTERNAL_QA_ONLY" ]]; then
  cat >&2 <<'EOF'
Este canal solo sirve para la validación temporal de Manuel y no produce una versión oficial.
Ejecuta con FENIX_CODE_INTERNAL_QA_ACK=MANUEL_INTERNAL_QA_ONLY tras confirmar ese alcance.
EOF
  exit 78
fi

repo_root="$(git rev-parse --show-toplevel)"
FENIX_CODE_BUILD_CHANNEL=internal-qa \
  bash "${repo_root}/scripts/fenix/build-companion-package.sh" macos-arm64
