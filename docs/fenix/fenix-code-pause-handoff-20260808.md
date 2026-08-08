# Fenix Code Pause Handoff

Date: 2026-08-08, Atlantic/Canary.

Repository: `james2233992/t3code` fork.

Local checkout: `/Users/juancarlosalonsonolasco-macmini2/Proyectos/Fenix-Code`.

Pause reason: the Fenix Code publication path is unresolved. The owner must either add `Fenix-Code` to the GitHub App installation or ask Fable to publish the approved heads. No further Fenix Code phases are built until token `RESUME_FENIX_CODE`.

## Binding Rule

Fenix Code keeps all original T3 Code functions and views identical. The allowed Fenix changes are:

- visible Fenix/AIWorks branding;
- hosted-domain rebrand away from T3;
- additive Fenix provider driver;
- fail-closed pairing and tenancy foundations.

Internal T3 identifiers are intentionally preserved for upstream rebase compatibility, including `T3ProjectFile`, `T3_PROJECT_FILE_NAME`, `t3ProjectFile.ts`, `@t3tools/*`, `t3.json`, and `T3CODE_HOME`.

## Approved Heads

| Area                       | Repo           | Head / ref                                                              | Fable token or verdict                                                         | Scope                                                                                                                             |
| -------------------------- | -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| F0 fork foundation         | Fenix-Code     | PR #1 merge `b5ec76ce`; head `cecac0734e3cce2a56585cbca09c312bce7de241` | `GO_READY_AND_MERGE_EXACT_HEAD: #1 @ cecac0734e3cce2a56585cbca09c312bce7de241` | Fork attribution, branding layer, inventory, rebrand of desktop/mobile/marketing, Fenix Fork CI 4/4.                              |
| F0.4 local builds and BYOS | Fenix-Code     | `daf05d7be`                                                             | `GO_F0_4_LOCAL_BUILDS: AUTORIZADO`; Fable ratified report                      | Server, web, desktop builds PASS; BYOS codex+claude PASS; zero observed runtime T3 calls.                                         |
| F0 visible rebrand         | Fenix-Code     | `5bbb2646d`                                                             | Fable rebrand content accepted, guard required fix                             | Visible T3 branding and t3.codes runtime-source residuals removed.                                                                |
| F0 guard closeout          | Fenix-Code     | `1d968f481484c73676c33266ac401083ff9d6657`                              | `F0-final CONTENT_GO exact-head`                                               | Guard fails hard without `rg`, includes red/green selftest, CI installs ripgrep. F0 closed.                                       |
| F1.1 Fenix driver          | Fenix-Code     | `4babc674080d268babaf3db2d96f743779a5b4b3`                              | `CONTENT_GO_EXACT_HEAD`                                                        | Additive 6th provider, disabled by default, no upstream driver changes.                                                           |
| F1.2 foundation hardening  | Fenix-Code     | `c969a20701999abc21ff2eebd32b4c1c81c352ef`                              | `CONTENT_GO_EXACT_HEAD / TECHNICAL_GO_FOUNDATION_ONLY`                         | Fail-closed adapter, origin-bound auth, concurrent turn guard, typed URL errors.                                                  |
| F1.2b pairing envelope     | Fenix-Code     | `85ca9204e413f115d1c013a3501a827e9d1e9240`                              | `CONTENT_GO_EXACT_HEAD / TECHNICAL_GO_FOUNDATION_ONLY`                         | Snapshot envelope with mandatory expiry, central active-session validation, resolver once per accepted turn.                      |
| F1.2 payload contract      | Fenix-Code     | `b502ef938ecdf3d8dbb4bf75b0fc6b15e3c631a9`                              | `CONTENT_GO_EXACT_HEAD`                                                        | Sends `turnId` and `requestId=turnId`; canonical model `groq/openai/gpt-oss-120b`; legacy alias canonicalized.                    |
| Fenix Code pause closeout  | Fenix-Code     | `codex/fenix-code-f1-2-pairing-20260808` handoff tip                    | Fable ordered pause closeout after F1.3 ratification                           | This handoff document only; no functional changes.                                                                                |
| Companion credential prep  | Monorepo Fenix | `b7d78d24e89ce86fba52ab56d6da639f065de0aa`                              | `CONTENT_GO_FOUNDATION_EXACT_HEAD`                                             | Short companion credentials, per-device replacement, flags off.                                                                   |
| ChatModels auth handler    | Monorepo Fenix | `8c05f0eb0e8173bb84a81efe90d1ac8457e8a0dd`                              | `CONTENT_GO_EXACT_HEAD`                                                        | `CodeLabFenixCredential` auth for ChatModels, exact audience/scope, request DB reauthorization.                                   |
| HTTP foundation            | Monorepo Fenix | `835589aa75cc961c3220529ead092dc27a836b22`                              | `CONTENT_GO_EXACT_HEAD`                                                        | `POST /api/v1/ChatModels/SendMessageWithOptions`, fake/fail-closed service, flags off.                                            |
| F1.3 tenancy foundation    | Monorepo Fenix | `8f8db51c7c8999e481daf05c1cebd9abcf08bddc`                              | `CONTENT_GO_EXACT_HEAD`                                                        | Parametrized CodeLab tenancy gate, optional `AllowedUserIds=[]` semantics documented and tested, isolated `ValidateOnStart` test. |
| Fenix Code pause roadmap   | Monorepo Fenix | `056605de5a312d70d8fc47c0cda50b836ca01e70`                              | Fable ordered pause closeout after F1.3 ratification                           | ROADMAP pause pointer only; no functional changes.                                                                                |

## Current Local Branches

Fenix-Code stack branches:

- `codex/fenix-code-f0-bootstrap-20260808` at `3bc44a319`.
- `codex/fenix-code-f0-branding-layer-20260808` at `72958d702`.
- `codex/fenix-code-f0-4-local-builds-20260808` at `1d968f481`.
- `codex/fenix-code-f1-1-driver-20260808` at `4babc6740`.
- `codex/fenix-code-f1-2-pairing-20260808` at the handoff tip containing this document.

Monorepo Fenix stack branch:

- `codex/fenix-codelab-companion-credential-20260808` at `056605de5`.

## Backups

Final consolidated bundles are stored under:

- `/Users/juancarlosalonsonolasco-macmini2/Backups/fenix-code-bundles/`
- `/Users/juancarlosalonsonolasco-macmini2/Backups/fenix-monorepo-bundles/`

Each bundle has a `.sha256` file and was verified by cloning into a temporary directory, checking expected heads, and deleting the temporary clone.

## Resume Queue

Do not continue Fenix Code until Fable emits `RESUME_FENIX_CODE`.

When resumed:

1. Publish the approved Fenix-Code and monorepo stacks through the resolved GitHub lane.
2. Open PRs with exact-head review and CI for the already-approved local stack.
3. Build `F1_3_E2E_COMPLETE`: local isolation for Fenix-Code workspaces, threads, checkpoints, sessions, and projections; negative cross-company assertions.
4. Build F1.2c active bridge: companion to broker, active pairing session from monorepo to Fenix-Code, end-to-end against the real reviewed HTTP contract.
5. Build F1.4 custom CLI agents with allowlisted binaries and explicit dangerous-flag opt-in.
6. Run full F1 QA E2E.
7. Only after F1 QA and explicit GO: consider publication, merges, deployment, or activation.

## Non-Goals While Paused

- No Fenix-Code bridge activation.
- No production deployment.
- No DML.
- No new provider execution path.
- No divergence from T3 Code UI/functionality beyond visible branding and the additive Fenix driver.
- No cleanup of internal T3 identifiers before the client-facing configuration phase.
