# Fenix Code macOS companion and visible-branding report

Date: 2026-08-13

Base: `01def1584ab32cea3f59e5e6ebe1d0a0fc2eb652`

## Operational model

The dedicated Fenix workstation runs the reviewed Fenix Code server bundle as
the current macOS user. The LaunchAgent is named `io.aiworks.fenix-code`, binds
only to `127.0.0.1:3773`, starts at login, restarts after failure and writes its
log below the user's protected Fenix Code state directory.

The LaunchAgent contains no portal credential, pairing secret or browser
cookie. The companion reads its existing `0600` configuration from
`~/.t3/userdata/fenix-companion.json`. All directories below `~/.t3` are `0700`
and all files are `0600`, including SQLite state, logs and signing keys. The
allowed workspace root is the dedicated `Proyectos` directory; project
registration still applies canonical `realpath` containment before storing
tenant ownership.

The active service executes the bundle produced from this Fenix Code checkout.
It does not install or run the public upstream `t3` package. Remote package
self-update is fail-closed because that package is not a trusted Fenix runtime;
an update must build the reviewed checkout and restart the user service.

## Local project sources

The original project workflow remains intact and supports:

- an existing local folder below an allowed root;
- an absolute local Git repository path below an allowed root;
- a `file://` Git repository URL below an allowed root;
- HTTPS, HTTP, SSH, Git and scp-style repository URLs cloned into an allowed
  local destination.

Paths outside the paired root, symlink escapes, malformed/control-character
URLs and destinations outside the paired root are rejected before project
creation or clone. A project whose tenant ownership cannot be persisted is
deleted immediately; it cannot remain as an unowned shared resource.

## Visible branding

The web favicon, 16/32 px icons, Apple touch icon and production logo now use
the Fenix source assets. The CLI root name, service guidance, relay guidance,
update messages, checkpoint label and Fenix Connect copy no longer expose T3.
Internal compatibility identifiers remain unchanged for upstream rebase
compatibility and are not user-visible.

The branding guard now fails on:

- visible `T3 Code`, `T3 Connect` and hosted T3 domains;
- visible commands that tell a user to run or install `t3`;
- any of the four legacy T3 web icon hashes;
- any public web icon that differs from its reviewed Fenix source asset.

Its self-test plants both textual and binary regressions and proves they are
detected before returning green.

## Verification

- macOS LaunchAgent plist: `plutil` PASS.
- forced service restart: PID rotated, loopback listener restored and TLS
  companion connection re-established.
- CLI identity: `fenix-code v0.0.32`.
- focused service, CLI, update and branding tests: PASS.
- companion configuration and short-lived pairing bridge tests: PASS.
- project root/clone/ownership websocket negatives: PASS.
- CodeRabbit CLI review after remediation: 0 findings.
- repository typecheck across 15 packages: PASS (pre-existing Effect
  suggestions only).
- canonical repository suite across 14 packages: 6,755 passed, 7 skipped and
  0 failed.
- server bundle and `/code-lab/` web build: PASS.
- favicon, 16/32 px and Apple touch source/public/web-build/server-bundle
  SHA-256 values: byte-identical per variant.

## Production activation

The reviewed web build is served from `https://iaonline.io/code-lab/` on the
existing Fenix origin. No T3 domain, DNS record, certificate or separate vhost
is involved. The production frontend is pinned to revision
`bd29f50c8b771c472a3a2f75cedeaced1cb9c432`; the backend pairing and tenancy
policy is pinned to revision
`27badb672d1827c76b251c439a70b9915bce1263`.

Production authorization is deliberately narrow: company `1`, user `2` and
agent `9`. The web route, session endpoint, device endpoint and ChatModels
catalog all return `401` without an authenticated Fenix session. An
authenticated user still needs the exact active, non-expired assignment and
the company/user/agent allowlists before the control plane is reached.

Authenticated browser QA confirmed:

- title `Fenix Code (Alpha)`, Fenix icons and zero visible `T3`, `T3 Code`,
  `T3 Connect` or `t3.codes` strings;
- the local companion `Mac mini Fenix`, its local project and existing local
  threads are visible only inside the assigned session;
- New Project exposes both `Local folder` and `Git URL`; the latter keeps the
  reviewed local absolute path, `file://` and remote Git URL contracts;
- desktop and mobile DOMs fit their viewport without document-width overflow;
- one non-fatal shell-snapshot warning falls back to the websocket snapshot;
- one companion rotation briefly showed reconnecting and recovered
  automatically without restarting the service or losing project state.

During QA, multiple duplicate Code Lab tabs were closed after they caused
avoidable concurrent session/device polling. A single active Code Lab tab is
the supported operational baseline until duplicate-tab load is separately
rate-shaped. This does not weaken tenant authorization or expose local data.

## Boundaries

The production pilot is active for the single reviewed identity above. It does
not grant access to another user, company or agent, does not share workstation
files through the portal, and does not expand the tenant-scoped RPC allowlist.
Adding a user requires a separate explicit allowlist and active assignment;
pairing binds that user to their own loopback companion and tenant-owned local
resources.
