# Fenix Code Login-Bound Activation - 2026-08-13

## Objective

The official Fenix Code companion package must not install or start as a usable server outside an authorized Fenix account. Authorization remains scoped to the authenticated Fenix company, user, agent, device, and approved local roots.

## Security Contract

1. The browser keeps the Fenix `AuthToken` in its HttpOnly cookie. The raw login cookie is never copied into the installer, command line, local config, logs, or Fenix Code runtime.
2. An authenticated Fenix session issues a short-lived, one-time pairing attempt from the `/code-lab/setup` landing.
3. The official installer accepts only `https://iaonline.io` as its portal authority. It validates and consumes that pairing before completing installation.
4. Successful pairing writes only the revocable device credential to `fenix-companion.json`, as a regular `0600` file. A failed or reused pairing rolls the installation and prior config back.
5. The packaged runtime carries an immutable build marker and the launcher/service sets `FENIX_CODE_REQUIRE_PORTAL_AUTH=1`.
6. Before the local HTTP server listens, startup requests a short-lived runtime ticket from Fenix. Missing, expired, revoked, malformed, wrong-owner, or unavailable authorization fails closed.
7. The active tunnel requests a fresh runtime ticket and Fenix reauthorizes company, user, agent assignment, and device access. Authorization loss terminates the local server instead of retrying as an offline standalone product.
8. Local workspace roots remain realpath-scoped and tenant-scoped. The login-bound activation does not expand remote RPC permissions or share local workspace data with another Fenix user.

## User Flow

1. Sign in to Fenix and open `/code-lab/setup`.
2. Download the Fenix Code package for the local operating system.
3. Generate the secure installation command. The command contains a one-time pairing token, not the Fenix login cookie.
4. Run the command and enter the exact existing local root that the user wants to authorize.
5. Install the local service. Every service start remains dependent on live Fenix authorization.

## Verification

- Installer without authorization: rejected before installation writes.
- Installer with an authority other than `https://iaonline.io`: rejected before installation writes.
- Valid one-time authorization: installation and `0600` device config succeed.
- Reused authorization: rejected; existing config remains byte-identical.
- Packaged runtime without pairing: rejected before listening.
- Portal preflight: bounded to 10 seconds and cancelled on timeout; startup cannot hang indefinitely.
- Authorization lost after startup: server stop callback runs once; no offline retry loop.
- Service definitions: launchd and systemd force portal authorization.
- Landing: emits the combined authorize-and-install command and rejects unsafe archive names.
- Server suite: 2,009 passed, 7 skipped on the final source tree.
- Web suite: 2,022 passed on the final source tree.
- Final macOS ARM64 artifact: 143,332,151 bytes; SHA-256 `e9bd57594f37cc200952defa7a5790541a2408b4bf26bbc27fab60709e28da54`.

## Limits

- This is authorization enforcement, not absolute DRM. A machine owner with full write access can modify open-source local software. The official package and supported launch paths are fail-closed, and the remote Fenix service remains the authority for pairing, runtime tickets, revocation, and tenant identity.
- The device credential is intentionally not the browser login token. Requiring the raw HttpOnly cookie in a desktop process would weaken browser isolation and expose the primary Fenix session.
- This candidate does not deploy the package, change production flags, assign additional users, or alter database state.
