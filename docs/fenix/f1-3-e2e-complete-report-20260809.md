# F1.3 E2E Complete Tenancy Report

Date: 2026-08-09, Atlantic/Canary.

Branch: `codex/fenix-code-f1-3-e2e-part2-20260809`.

Base: `main @ b79ad56f2f6f34bb40129d0822026df600a40bb1` (`tree cd8808cf45be16097f257485cfadcf36ab0644f5`).

Authorization: `GO_F1_3_PART2_E2E: AUTORIZADO`.

## Scope

This candidate completes the local Fenix Code tenancy E2E foundation on top of the merged F1.3 scoped projection foundation.

Implemented:

- workspace RPC access for Fenix-scoped sessions is allowed only when `cwd` normalizes to an active project owned by the pairing tenant;
- workspace search/list/read/write against a foreign project root fails before `WorkspaceEntries` or `WorkspaceFileSystem` runs;
- global filesystem browse, source-control, VCS/worktree, terminal, preview, review, provider/settings/process, and orchestration command dispatch remain denied for Fenix-scoped sessions;
- projection tests now assert independent company and user scoping across workspaces, projects, threads, sessions, checkpoints, full-thread diff context, snapshots, and search;
- the E2E fixture keeps the Fenix identity source single: `fenixCodeTenantScope` carried by the authenticated pairing session.

Not implemented:

- F1.2c active bridge;
- F1.4 custom CLI agents;
- provider execution;
- production activation;
- monorepo changes;
- DML.

## Identity Contract

Normal T3 Code sessions still have no `fenixCodeTenantScope` and continue using the original unscoped behavior.

Fenix-scoped sessions do not get a second identity source in RPC inputs. The company/user scope comes only from the authenticated pairing envelope. Request bodies can choose resource ids and paths, but they cannot choose tenant scope.

## Surface Coverage

Workspaces:

- `projects.searchEntries`, `projects.searchContents`, `projects.listEntries`, `projects.readFile`, and `projects.writeFile` validate the normalized workspace root against `FenixScopedProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot`;
- foreign existing workspace roots return typed `Project*Error` responses and do not call the underlying workspace services;
- own workspace roots call the existing T3 workspace services unchanged.

Threads:

- scoped shell and detail reads enumerate only tenant-owned threads;
- direct reads by foreign thread id, same-company/other-user thread id, and other-company/same-user thread id all return `None`;
- `subscribeThread`, `getTurnDiff`, and `getFullThreadDiff` remain guarded before replay, live events, or diff services.

Checkpoints:

- own checkpoint context and full-thread diff context resolve only through a tenant-owned thread;
- foreign, same-company/other-user, and other-company/same-user checkpoint/diff reads return `None`;
- checkpoint summaries still include the existing turn/checkpoint metadata for owned threads.

Sessions:

- projected sessions are visible only through owned thread shell/detail/snapshot enumeration;
- the same session-shaped fixture in another company or user is absent from scoped reads.

Projections:

- shell snapshots, full snapshots, command read models, counts, targeted project/thread reads, workspace-root lookup, search, checkpoint context, and detail snapshots all go through the scoped projection wrapper;
- empty valid scopes preserve the global snapshot sequence instead of resetting to `0`, keeping handoff cursors monotonic.

WS/RPC transport:

- the central Fenix scoped allowlist remains fail-closed;
- dangerous command payloads stay blocked because `dispatchCommand` is not allowlisted for Fenix-scoped sessions;
- tests assert `dispatchCalls=0` for blocked privileged orchestration payloads and no workspace service calls for foreign roots.

## Gates

Baseline from `b79ad56f` / merged F1.3 report:

- focal suite: `6 files / 171 tests PASS`.

Candidate focal:

- `vp test apps/server/src/orchestration/Layers/FenixScopedProjectionSnapshotQuery.test.ts apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts apps/server/src/server.test.ts apps/server/src/provider/Drivers/FenixDriver.test.ts apps/server/src/provider/Layers/FenixAdapter.test.ts packages/shared/src/model.test.ts`
- Result: `6 files / 172 tests PASS`.

Static:

- `git diff --check`
- `vp check`
- `vp run --filter t3 --filter @t3tools/contracts typecheck`
- `vp check` result: PASS, `2515` files formatted, `2381` files linted with no warnings/errors.
- Typecheck result: PASS. Remaining output is pre-existing `TS377019` suggestions in `src/orchestration/decider.ts` and `src/orchestration/workflowScriptQuery.ts`, outside this delta.

Branding/inventory:

- `bash scripts/fenix/generate-branding-inventory.sh selftest`
- `bash scripts/fenix/generate-branding-inventory.sh generate`
- `bash scripts/fenix/generate-branding-inventory.sh check`
- `bash scripts/fenix/check-visible-branding.sh selftest`
- `bash scripts/fenix/check-visible-branding.sh`
- Result: PASS (`selftest-pass`, `visible-branding-selftest-pass`, `visible-branding-pass`).

## Resume Queue

This candidate is content for F1.3 part 2 only. Fable must declare `F1_3_E2E_COMPLETE` after exact-head review and merge verification.

Next phases remain gated by separate tokens:

1. F1.2c active bridge.
2. F1.4 custom CLI agents.
3. QA F1 complete.

No activation is implied.
