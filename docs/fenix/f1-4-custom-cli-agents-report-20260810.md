# Fenix Code F1.4 Custom CLI Agents Report

Date: 2026-08-10, Atlantic/Canary.

Branch: `codex/fenix-code-f1-4-custom-agents-20260810`.

Base: `main @ cf9dbbb89f2a1b7387a6af881dd876f12914f34c`.

Authorization: `GO_F1_4_CUSTOM_AGENTS: AUTORIZADO` (`owner-relay`).

## Scope

This candidate adds local custom CLI agents as a provider driver foundation.
It is local-only and inert unless the user explicitly configures a
`providerInstances` entry with `driver: customCli`.

Implemented:

- `customCli` provider driver registered as an additive built-in driver;
- local template schema with name, binary path, argv, env, allowlist extension,
  dangerous-flag opt-in, model slug, and custom model entries;
- fail-closed binary allowlist with exact entries only and no wildcards;
- `ChildProcess.make(..., { shell: false })` execution with argv and stdin;
- validation against control characters and shell metacharacters in template
  name, args, binary entries, and env values;
- dangerous flags blocked by default, with opt-in scoped to one template;
- provider runtime events for the standard session/turn/content/completion
  cycle;
- Fenix-scoped websocket sessions remain unable to create, edit, or execute
  custom CLI agents because `server.updateSettings` and `dispatchCommand`
  stay denied by the central scoped RPC barrier.

Not implemented:

- remote template creation through the Fenix bridge;
- provider execution through production Fenix;
- production activation;
- monorepo changes;
- DDL/DML;
- embedded third-party binaries.

## Security Contract

Custom CLI templates are owned by local user configuration only. The Fenix
bridge cannot supply or mutate templates in this phase.

The executable allowlist is fail-closed:

- default exact entries: `codex`, `claude`, `cursor-agent`, `grok`, `opencode`;
- local extensions must be exact entries, one by one;
- wildcard patterns are rejected;
- the selected binary must match the default set or an explicit local extension.

The process launch path never uses a shell. Prompt text is streamed to stdin,
not interpolated into a command string.

Dangerous flags are denied unless the specific template sets
`allowDangerousFlags=true`. Covered examples include `--force`, `--yolo`,
`--dangerously-*`, `--allow-all`, `--full-access`,
`--approval-policy=never|on-failure`, and sandbox escalation flags.

## Coverage

Focal tests cover:

- positive session cycle using a fake harness binary, with shell disabled and
  env merge verified;
- binary outside allowlist rejected before spawn;
- wildcard allowlist entry rejected before spawn;
- dangerous flag rejected without opt-in and accepted with explicit opt-in;
- shell/control injection rejected in template name, args, and env values;
- failed child process restores the session to ready and emits terminal failure;
- concurrent turn rejected while one turn is active;
- provider registry boots all seven built-in drivers, including `customCli`,
  without sharing adapter, snapshot, or text-generation closures;
- Fenix-scoped WS session cannot call `server.updateSettings` with a
  `customCli` provider instance payload.

## Gates

Baseline:

- Base commit: `cf9dbbb89f2a1b7387a6af881dd876f12914f34c`.
- Baseline focal surface: `4` existing tests (`ProviderInstanceRegistryLive`
  plus the Fenix scoped WS global-RPC denial).

Focal:

- `vp test run src/provider/Layers/CustomCliAdapter.test.ts src/provider/Layers/ProviderInstanceRegistryLive.test.ts src/server.test.ts -t "CustomCliAdapter|ProviderInstanceRegistryLive|denies global websocket rpc methods for Fenix tenant scoped sessions"`
- Result: `3 files / 11 tests PASS` (`124` skipped by name filter), `+7`
  ratchet from the new custom CLI adapter suite.

Typecheck:

- `pnpm --filter @t3tools/contracts typecheck`: PASS.
- `pnpm --filter t3 typecheck`: PASS. Remaining output is pre-existing
  `TS377019` suggestions in `src/orchestration/decider.ts` and
  `src/orchestration/workflowScriptQuery.ts`, outside this delta.

Static and branding:

- `git diff --check`: PASS.
- `vp check`: PASS (`2526` formatted, `2390` linted, zero warnings/errors).
- `bash scripts/fenix/generate-branding-inventory.sh selftest`: PASS.
- `bash scripts/fenix/generate-branding-inventory.sh generate`: PASS.
- `bash scripts/fenix/generate-branding-inventory.sh check`: PASS.
- `bash scripts/fenix/check-visible-branding.sh selftest`: PASS.
- `bash scripts/fenix/check-visible-branding.sh`: PASS.

## Limits

This candidate does not activate Fenix Code, call real providers, deploy, touch
production, or modify database schema/data.

`binaryPath` may be a bare executable name resolved by the process `PATH`;
this is accepted for local BYOS templates and has the same trust boundary as
the upstream local CLI model.

`F1_4_CUSTOM_AGENTS_COMPLETE` remains a Fable declaration after exact-head
review and merge verification.
