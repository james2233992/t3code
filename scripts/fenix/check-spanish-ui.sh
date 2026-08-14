#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

scan_paths=(apps/web/src)

require_rg() {
  if ! command -v rg >/dev/null 2>&1; then
    echo "ripgrep (rg) is required for Spanish UI checks." >&2
    return 127
  fi
}

run_rg_allow_no_matches() {
  local output
  local status

  set +e
  output="$(rg "$@" 2>&1)"
  status=$?
  set -e

  if [[ "$status" -eq 0 || "$status" -eq 1 ]]; then
    printf '%s' "$output"
    return 0
  fi

  echo "rg failed while scanning the Spanish UI contract:" >&2
  printf '%s\n' "$output" >&2
  return "$status"
}

run_checks() {
  require_rg

  local english_hits
  english_hits="$(
    run_rg_allow_no_matches \
      --hidden \
      --no-messages \
      --with-filename \
      --text \
      -n \
      --glob '!*.test.*' \
      --glob '!*.stories.*' \
      --glob '!*.wasm' \
      -e 'What should we work on\?|Add project|No projects yet|No threads found|Project settings' \
      -e 'Search settings|Settings search results|Couldn.t start a new thread|Connect an environment to get started' \
      -e 'Open a surface|Choose what to show in the right panel|Working tree|Branch changes|Latest turn' \
      -e 'Full access|Supervised|Ask anything|Enable a provider in Settings|Publish repository' \
      -e 'Something went wrong|Try again|Reload app|Show error details|request failed with HTTP' \
      -e 'Copy (path|code|link|command|trace ID)|Failed to |Unable to |Loading (messages|devices|settings|threads)' \
      -e 'No matching |No archived threads|Update available|Provider update failed|Theme saved' \
      -e 'This (thread|environment|project)|Open Settings|Add environment|Authorized clients' \
      -e 'title: "New thread"|label: `New thread|Start a new chat|Branch (name )?copied' \
      -e '>Connecting |Couldn.t connect' \
      -e 'Open in (integrated|system) browser|Copy Link|Sign in|Create link|Fenix Connect enabled' \
      -e 'Initializing repository|Pulling latest changes|Publishing repository|Preparing pull request' \
      -e 'Idle . resumable|Direct spawns|Updating providers?|Running provider update' \
      -e 'label: "(Repository conventions|Unpin thread|Pin thread|Settle thread|Wake thread|Snooze)' \
      -e 'aria-label="(Decrease|Increase) (idle|active) host|>seconds<' \
      -e '>Usage<|>Settings<|>Back<|aria-label="Command palette"' \
      "${scan_paths[@]}"
  )"

  if [[ -n "$english_hits" ]]; then
    echo "English product chrome remains in the Spanish Fenix Code surface:" >&2
    echo "$english_hits" >&2
    return 1
  fi

  local required_spanish
  required_spanish="$(
    run_rg_allow_no_matches \
      --fixed-strings \
      --glob '!*.test.*' \
      --glob '!*.stories.*' \
      -e '¿En qué vamos a trabajar?' \
      -e 'Añadir proyecto' \
      -e 'Ajustes' \
      -e 'Conversaciones archivadas' \
      -e 'Acceso completo' \
      -e 'Directorio de trabajo' \
      "${scan_paths[@]}"
  )"

  local required_literal
  for required_literal in \
    '¿En qué vamos a trabajar?' \
    'Añadir proyecto' \
    'Ajustes' \
    'Conversaciones archivadas' \
    'Acceso completo' \
    'Directorio de trabajo'; do
    if [[ "$required_spanish" != *"$required_literal"* ]]; then
      echo "Required Spanish product copy is missing: $required_literal" >&2
      return 1
    fi
  done
}

selftest() {
  require_rg

  local test_file="apps/web/src/components/__fenix_spanish_ui_guard_red_test__.$$.tsx"
  local red_output
  local red_status

  trap 'rm -f "$test_file"' RETURN
  scan_paths+=("$test_file")
  printf 'export function Regression() { return <p>What should we work on?</p>; }\n' > "$test_file"

  set +e
  red_output="$(run_checks 2>&1)"
  red_status=$?
  set -e

  if [[ "$red_status" -eq 0 ]]; then
    echo "selftest failed: English UI fixture was not detected." >&2
    return 1
  fi
  if [[ "$red_output" != *"What should we work on?"* ]]; then
    echo "selftest failed: red case failed for an unexpected reason." >&2
    echo "$red_output" >&2
    return 1
  fi

  rm -f "$test_file"
  scan_paths=("${scan_paths[@]:0:${#scan_paths[@]}-1}")
  run_checks
  echo "spanish-ui-selftest-pass"
}

case "${1:-check}" in
  check)
    run_checks
    echo "spanish-ui-pass"
    ;;
  selftest)
    selftest
    ;;
  *)
    echo "usage: $0 [check|selftest]" >&2
    exit 64
    ;;
esac
