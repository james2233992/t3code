# Fenix Code local workspace relay report

Date: 2026-08-12

Base: `aa94094d85cec518ba046e992ca313783d99d539`

## Scope

This candidate keeps the original Fenix Code/T3 Code project and connection UI
and adds one environment transport: a local companion reached through the Code
Lab websocket broker on the current `iaonline.io` origin.

The original local folder picker, Git clone flow, remote-link connection, SSH
connection, project model, and source-control service remain in place. No
layout, typography, spacing, colors, or existing provider driver was replaced.

## Supported project sources

| Source                                      | Result                                  |
| ------------------------------------------- | --------------------------------------- |
| Existing folder under a paired root         | Allowed                                 |
| Absolute local Git path under a paired root | Allowed                                 |
| `file://` URL under a paired root           | Allowed                                 |
| HTTPS/HTTP/SSH/Git/scp-style remote URL     | Allowed                                 |
| Local source outside paired roots           | Rejected before clone                   |
| Destination outside paired roots            | Rejected before clone                   |
| Symlink escape                              | Rejected by canonical `realpath` checks |
| Unknown URL protocol or control characters  | Rejected                                |

## Trust and tenancy

Nginx authorizes every `/code-lab/` document and asset through the existing
cookie-first Fenix session before serving it. The web application repeats that
check before mounting the shell. The browser then obtains a short-lived broker
ticket using the same session. An unauthenticated browser receives no Fenix Code
HTML, JavaScript, WASM, pairing ticket, or websocket session.

The local companion independently obtains a runtime ticket using its device
credential. The backend binds both sides to the same paired device and includes
the reauthorized company/user owner in the runtime ticket.

The companion creates a five-minute local websocket session carrying that
server-issued tenant scope, rotates it after four minutes, and revokes it during
cleanup. RPC frames are transported in a bounded `rpc.frame` envelope; broker
control messages and malformed or oversized frames are not forwarded to the
Effect RPC client.

Project creation, Fenix-only thread creation, one Fenix turn, checkpoint revert,
safe title metadata, and owned-thread lifecycle commands are admitted through an
exhaustive scoped command policy. The workspace root is canonicalized against
the local allowlist, project ownership is persisted atomically in the scoped
projection, and a failed persistence operation triggers deletion of the
just-created unclaimed project. An ownership collision is not deleted because
it may belong to the winning tenant.

Filesystem content access remains limited to an active project owned by the
pairing tenant. Directory browsing needed by Add Project may inspect configured
roots before registration, but cannot leave those roots. Global terminal,
preview, provider/settings/process, arbitrary VCS/worktree, setup-script, and
custom-agent RPCs remain denied. Scoped turns are pinned to the Fenix provider,
the canonical `groq/openai/gpt-oss-120b` model and `approval-required` runtime;
client-supplied worktree paths, branches, setup scripts, provider changes and
full-access runtime modes are rejected before command normalization.

## Operational boundary

This candidate completes pairing, browsing, cloning, project registration and
the standard project -> thread -> Fenix turn -> checkpoint -> revert cycle for
local folders, local Git paths/URLs, and the existing remote URL forms. The
exhaustive command policy keeps terminal, setup-script, arbitrary VCS,
worktree, preview and custom-agent execution closed for Fenix-scoped sessions.

The web build is rooted at `/code-lab/` through Vite and TanStack Router. The
portal stages a reviewed, clean, exact Fenix Code commit into its image and
records the source commit, tree and aggregate artifact SHA-256 in a manifest.

The dedicated `/code-lab/ws` broker and its raw ticket response are intentional
cross-repository contracts. They are not interchangeable with `/AIWorks_Hub`
or the legacy `ExternalReturnData` response shape: both browser and companion
consume the broker path, subprotocol, one-shot ticket, and reauthorized owner
envelope directly.

## Verification

- Fenix Code server suite: `221` files PASS, `2` skipped; `1997` tests PASS,
  `7` skipped.
- Fenix Code web suite: `223/223` files and `2014/2014` tests PASS.
- Shared client runtime suite: `47/47` files and `592/592` tests PASS.
- Focused server path/ownership tests: PASS.
- Focused client broker framing tests: PASS.
- Scoped command-policy and authenticated static-app tests: PASS.
- Production web build at `/code-lab/`: PASS; `0` sourcemaps and `2` WASM
  artifacts.
- Fenix server and web typechecks: PASS (only pre-existing Effect suggestions
  in unrelated orchestration files).
- Repository formatter/linter: PASS with zero warnings or errors.
- Monorepo backend Code Lab tests: `85` PASS, `1` MySQL integration test skipped.
- Monorepo backend complete suite: `4643` PASS, `1` MySQL integration test
  skipped.
- Portal Code Lab panel and isolation tests: `19/19` PASS.
- Monorepo backend build: PASS with pre-existing package-reference warnings.
- Portal full suite ratchet: the candidate produced `9849` PASS and `9` failures
  outside Code Lab. The base commit reproduces the `8` OpenAI Playground
  failures, while the single NEXPA failure passes when isolated. No changed
  Code Lab test failed.
- Portal full build: blocked identically on the base commit by pre-existing
  Recharts formatter typings and a pre-existing `SiOpenai` import outside the
  Code Lab delta.
- CodeRabbit exact-diff review: `0` findings.

## Deployment status

No production deployment, flag change, DDL, DML, DNS, certificate, or provider
activation is part of this candidate. The browser, backend owner envelope, and
local companion changes must be deployed as one reviewed release; otherwise
the feature remains fail-closed.
