# Fenix Code onboarding and companion download report

Date: 2026-08-13

Base: `594bde30383d7dce446517f794b746e111a047bb`

## Scope

This candidate adds an authenticated Spanish setup route at
`/code-lab/setup`. It is separate from the editor shell, so the existing Fenix
Code project, thread, diff, checkpoint, settings, provider and permission-mode
interfaces are unchanged.

The page follows the visual composition of the original product landing while
using only Fenix Code identity, copy, assets and downloads. It contains no
visible T3 name, command, icon, hosted domain, source-repository link or
testimonial.

## Access and isolation

The route remains below `/code-lab/`. Production Nginx authorizes every page,
asset, manifest and archive in that prefix through the cookie-first Fenix
session. The web root then repeats the agent-scoped session check before the
route mounts.

Pairing is generated only through the existing authenticated Code Lab API. The
one-time command binds company, user, agent and device. Each device keeps its
own local credential, explicit allowed roots, projects and sessions. The page
does not upload local folders and does not expose another user's roots.

## macOS artifact

The package producer uses the reviewed server bundle and the monorepo's exact
production dependency graph. It includes the official Node.js 22.21.1 Darwin
ARM64 runtime after verification against the official Node.js SHA-256 list. It
removes optional binaries for other operating systems and does not install the
public upstream package during setup.

- Artifact: `Fenix-Code-Companion-0.0.32-macos-arm64.tar.gz`
- Size: `143325272` bytes (`136.7 MB`)
- SHA-256: `b3e0e2e806267f676a07ed04a7cf9dfa6340d2cb94b062a52174b8e2dc1e41d7`
- Supported pilot platform: Apple Silicon, macOS 13 or later
- Installation privilege: current user only; no `sudo`

The setup page requires an explicit Apple Silicon selection when browser
architecture detection is ambiguous. Selecting Intel never exposes the ARM64
archive. The installer stages and smokes the complete replacement before
activation, then restores the prior runtime, Node binary and wrapper if a
post-activation check fails.

The generated manifest marks Windows x64 and Linux x64 unavailable. Their tabs
explain that the native packages are still being validated and never point to
an external or placeholder download.

## Verification

- Packaged install in a disposable `HOME`: PASS.
- Packaged CLI identity: `fenix-code v0.0.32`.
- Unpaired status after installation: fail-closed, as expected.
- Forced post-activation installer failure: previous installation restored
  byte-for-byte; PASS.
- Focused manifest and pairing tests: `13/13` PASS.
- Complete web suite: `224/224` files and `2021/2021` tests PASS.
- Web typecheck: PASS.
- Repository format and lint: `2550` formatted, `2406` linted, zero findings.
- Production web build with base `/code-lab/`: PASS.
- Visible-branding guard and self-test: PASS.
- Branding inventory self-test, regeneration and check: PASS.
- Browser QA at 1440x900 and 390x844: no document-width overflow, no console
  errors, no visible T3 string and a visible hint of the installation section.
- Windows unavailable state: no download link rendered.

## Compatibility boundary

Internal compatibility identifiers required by the upstream rebase strategy
remain in runtime paths and source symbols. They are not shown in the landing,
installer output, CLI identity or editor UI. Renaming those identifiers is not
part of this candidate because it would break the pinned runtime/service
contract without improving visible branding.

## Publication boundary

The archive and its manifest must be published together with this exact web
build under `/code-lab/`. Publishing either file outside that protected prefix
would bypass the reviewed session boundary and is not allowed.
