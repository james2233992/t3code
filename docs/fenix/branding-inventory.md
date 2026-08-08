# Fenix Code Branding Inventory

Date: 2026-08-08
Base upstream: `pingdotgg/t3code@8101cd044911c7dc2a2adf7c7a9ba7962abf57b6`
Fork: `james2233992/t3code`

This is the F0.2 read-only inventory required before the Fenix rebrand. It maps
where T3 identity appears today and separates runtime/product surfaces from tests,
docs, generated references, and vendored code.

## Scope And Evidence

The exact generated evidence is stored next to this file and is reproducible
with `bash scripts/fenix/generate-branding-inventory.sh generate`. Review can
verify it with `bash scripts/fenix/generate-branding-inventory.sh check`.
The generator uses `rg --json -I -o` plus `jq` formatting, so binary-file
warnings are excluded, filenames are always present, multiple occurrences on one
line remain distinguishable by column, and output order is deterministic.

- `branding-inventory-textual.matches.txt`: generated `file:line:column:match`
  rows for visible/product text and package strings.
- `branding-inventory-platform.matches.txt`: generated
  `file:line:column:match` rows for package names, schemes, bundle IDs, CLI
  names, and T3CODE env vars.
- `branding-inventory-endpoints-links.matches.txt`: generated
  `file:line:column:match` rows for T3-hosted URLs, store links, GitHub links,
  Clerk relying parties, and support links.
- `branding-inventory-visual.files.txt`: generated asset/component paths for
  icons, favicons, marks, splash, wordmark, and adjacent visual files.

The scans intentionally exclude lockfiles, build outputs, binary files, and
vendored references. They include tests and docs because rebrand regressions will
otherwise keep old strings alive in assertions.
The `.repos/` reference trees are excluded from the generated evidence: they are
vendored read-only references and must not be rebranded unless a later reviewed
dependency-sync policy says otherwise.

## Category 1: Textual Brand

Primary runtime/UI text to centralize behind Fenix branding:

| Surface | Current anchor |
| --- | --- |
| Root product docs | `README.md:1`, `README.md:3`, `README.md:26`, `README.md:32` |
| App guidance | `AGENTS.md:1`, `AGENTS.md:3`, `AGENTS.md:41` |
| Web brand config | `apps/web/src/branding.ts:19` |
| Web theme labels | `apps/web/src/themePalette.ts:330`, `apps/web/src/themePalette.ts:375`, `apps/web/src/themePalette.ts:398`, `apps/web/src/themePalette.ts:444`, `apps/web/src/themePalette.ts:470`, `apps/web/src/themePalette.ts:597`, `apps/web/src/themePalette.ts:815` |
| Web splash | `apps/web/src/components/SplashScreen.tsx:4`, `apps/web/src/components/SplashScreen.tsx:5` |
| Mobile mark/title | `apps/mobile/src/components/BrandMark.tsx:35`, `apps/mobile/src/components/CompactBrandTitle.tsx:48`, `apps/mobile/src/components/T3Wordmark.tsx:5` |
| Marketing/legal copy | `apps/marketing/src/pages/terms-of-service.astro:30`, `apps/marketing/src/pages/privacy-policy.astro:21`, `apps/marketing/src/pages/security-policy.astro:30` |
| CLI help/docs | `apps/server/src/cli/pair.ts:81`, `apps/server/src/cli/service.ts:61`, `apps/server/src/terminal/BunPtyAdapter.ts:17`, `docs/user/install.md:14` |

Rebrand rule: runtime strings should read `Fenix Code`; historical attribution may
refer to T3 Code only inside `ATTRIBUTION.md`, `LICENSE`, and explicitly marked
upstream/history notes.

## Category 2: Visual Brand

High-risk visual assets and components:

| Surface | Current anchor |
| --- | --- |
| Shared/prod app icon source | `assets/prod/logo.svg`, `assets/prod/app-icon.icon/icon.json` |
| Desktop packaged icons | `apps/desktop/resources/icon.icns`, `apps/desktop/resources/icon.ico`, `apps/desktop/resources/icon.png` |
| Web favicons | `apps/web/public/favicon.ico`, `apps/web/public/favicon-16x16.png`, `apps/web/public/favicon-32x32.png`, `apps/web/public/apple-touch-icon.png` |
| Marketing favicons/icons | `apps/marketing/public/favicon.ico`, `apps/marketing/public/icon.png`, `apps/marketing/public/apple-touch-icon.png` |
| Mobile launcher/widget marks | `apps/mobile/assets/android-icon-mark.png`, `apps/mobile/assets/android-notification-icon.png`, `apps/mobile/assets/widget/T3Mark.svg` |
| Web/mobile brand components | `apps/web/src/components/SplashScreen.tsx`, `apps/mobile/src/components/BrandMark.tsx`, `apps/mobile/src/components/T3Wordmark.tsx` |

Rebrand rule: replace these with Fenix design-system assets and the official
paper-craft phoenix mascot. Do not remove the mascot from first-run/empty/brand
moments once introduced.

## Category 3: Platform Identity

Platform identifiers that must move together, not by ad hoc replacement:

| Surface | Current anchor |
| --- | --- |
| Workspace package scope | `package.json:2`, `apps/desktop/package.json:2`, `apps/mobile/package.json:2`, `packages/contracts/package.json:2`, `packages/client-runtime/package.json:2`, `packages/shared/package.json:2`, `packages/ssh/package.json:2`, `packages/tailscale/package.json:2` |
| CLI package/bin | `apps/server/package.json:2`, `apps/server/package.json:11` |
| Desktop product name | `apps/desktop/package.json:38` |
| Desktop URL schemes | `apps/desktop/src/electron/ElectronProtocol.ts:12`, `apps/desktop/src/electron/ElectronProtocol.ts:13` |
| Mobile schemes/bundle IDs | `apps/mobile/app.config.ts:64`, `apps/mobile/app.config.ts:65`, `apps/mobile/app.config.ts:66`, `apps/mobile/app.config.ts:67`, `apps/mobile/app.config.ts:72`, `apps/mobile/app.config.ts:73`, `apps/mobile/app.config.ts:74`, `apps/mobile/app.config.ts:75`, `apps/mobile/app.config.ts:80`, `apps/mobile/app.config.ts:81`, `apps/mobile/app.config.ts:82`, `apps/mobile/app.config.ts:83` |
| Store/package commands | `README.md:43`, `README.md:49`, `README.md:55`, `docs/user/install.md:29`, `docs/user/install.md:35`, `docs/user/install.md:41` |
| T3CODE env/config namespace | `.github/workflows/release.yml:333`, `.github/workflows/release.yml:336`, `.github/workflows/release.yml:873`, `.github/workflows/release.yml:875` |

Rebrand rule: platform identifiers need a compatibility decision per surface.
Desktop/web can move in F0; mobile store IDs and signing stay cataloged but outside
F0 until owner/store GO.

## Category 4: External Endpoints And Calls Home

High-risk runtime and release endpoints:

| Surface | Current anchor |
| --- | --- |
| Hosted web app default | `packages/shared/src/connectAuth.ts:15` |
| Hosted web router build | `apps/web/vercel.ts:3`, `apps/web/vercel.ts:5`, `apps/web/vercel.ts:6` |
| Release workflow domains | `.github/workflows/release.yml:927`, `.github/workflows/release.yml:928`, `.github/workflows/release.yml:929` |
| Desktop update link | `apps/web/src/components/desktopUpdate.logic.ts:6` |
| Marketing release/download links | `apps/marketing/src/lib/site.ts:1`, `apps/marketing/src/pages/index.astro:59`, `apps/marketing/src/pages/download.astro:83` |
| Clerk relying party/domain | `apps/mobile/app.config.ts:68`, `apps/mobile/app.config.ts:76`, `apps/mobile/app.config.ts:84`, `packages/shared/src/relayAuth.test.ts:24` |
| Relay/T3 Connect infra | `infra/relay/src/db.ts:19`, `infra/relay/src/Config.ts:31`, `docs/internals/t3-connect.md:85` |

Rebrand rule: zero runtime traffic should target T3 infrastructure. Hosted app,
relay, release/update, Clerk, analytics/observability, and legal/support links
must either point to Fenix infrastructure or be disabled by explicit Fenix flags
before any production or customer-facing use.

## Category 5: Links And Support

Primary user-visible links:

| Surface | Current anchor |
| --- | --- |
| GitHub releases/fork | `README.md:38`, `apps/marketing/src/pages/index.astro:59`, `apps/marketing/src/pages/index.astro:353`, `apps/marketing/src/pages/index.astro:379`, `apps/marketing/src/pages/download.astro:83` |
| Store links | `README.md:3`, `apps/marketing/src/lib/site.ts:4`, `apps/marketing/src/lib/site.ts:7` |
| Discord/support | `README.md:107`, `apps/marketing/src/layouts/Layout.astro:75` |
| Legal pages | `apps/marketing/src/pages/privacy-policy.astro:21`, `apps/marketing/src/pages/terms-of-service.astro:30`, `apps/marketing/src/pages/security-policy.astro:30` |
| User docs | `docs/user/install.md:23`, `docs/user/remote-access.md:54`, `docs/user/updating.md:35` |

Rebrand rule: customer-facing links must move to Fenix-owned support, docs,
release, and legal locations. Store links remain non-F0 until signed mobile builds.

## Category 6: Visible Legal

Legal inventory:

| Surface | Current anchor |
| --- | --- |
| MIT license | `LICENSE:1`, `LICENSE:3` |
| T3 marketing terms | `apps/marketing/src/pages/terms-of-service.astro:30`, `apps/marketing/src/pages/terms-of-service.astro:43`, `apps/marketing/src/pages/terms-of-service.astro:108` |
| T3 privacy policy | `apps/marketing/src/pages/privacy-policy.astro:21`, `apps/marketing/src/pages/privacy-policy.astro:23`, `apps/marketing/src/pages/privacy-policy.astro:35` |
| T3 security policy | `apps/marketing/src/pages/security-policy.astro:30`, `apps/marketing/src/pages/security-policy.astro:31` |
| Native module notices | `apps/mobile/modules/t3-terminal/THIRD_PARTY_NOTICES.md`, `apps/mobile/modules/t3-markdown-text/LICENSE`, `apps/mobile/modules/t3-composer-editor/LICENSE` |

Rebrand rule: preserve MIT license and notices. Fenix legal pages must not claim
T3 Tools terms/privacy as Fenix terms; replace with Fenix-owned legal copy or
hide marketing/legal pages in internal-only builds until legal text is approved.

## Implementation Boundary For F0.3

Centralize first, then replace:

1. Keep upstream core untouched.
2. Introduce a Fenix branding config/module consumed by web, desktop, mobile, marketing, and CLI.
3. Move endpoint defaults into a Fenix-owned runtime config with fail-closed defaults.
4. Replace assets from the central export path, not by scattering imports.
5. Re-run these generated inventories after the rebrand. Required F0.3 exit: no unclassified T3 runtime hits outside attribution, license, upstream-history docs, fixture-only tests, and vendored references.

## F1 Bridge Notes

The Fenix monorepo already has local runner and pairing surfaces that look relevant
for the later bridge:

- `AIWork_API/Controllers/ChatWorkspaceController.cs`
- `AIWork_API/Controllers/LocalRunnersController.cs`
- `AIWork_API/Services/ChatWorkspace/ChatWorkspacePairingService.cs`
- `AIworks_2028_React/src/services/localRunnerService.ts`
- `AIworks_2028_React/src/components/dashboard/navigation/LocalExecutionLab.tsx`

These are not touched in F0. The future F1 bridge must be designed against the
indexed Fenix graph and then verified by reading the real source files.
