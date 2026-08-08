# Fenix Code F0.3 Branding Layer

Date: 2026-08-08

## Scope

This candidate introduces a central Fenix branding module at
`packages/shared/src/productBranding.ts` and wires the first runtime consumers to
it. The goal is to make product identity and owned endpoints explicit before any
asset replacement, package-scope migration, or production release.

## Applied Defaults

- Product display name: `Fenix Code`.
- Hosted app default: `https://code.iaonline.io`.
- Marketing site base: `https://iaonline.io`.
- GitHub release/source links: `https://github.com/james2233992/t3code`.
- Desktop schemes: `fenixcode`, `fenixcode-dev`.
- Desktop app identity: `com.aiworks.fenixcode`, `com.aiworks.fenixcode.dev`.
- Desktop user-data directories: `fenixcode`, `fenixcode-dev`, with legacy
  `T3 Code (Alpha)` and `T3 Code (Dev)` paths preserved for migration lookup.
- Mobile schemes: `fenixcode`, `fenixcode-dev`, `fenixcode-preview`.
- Mobile bundle/package identifiers: `com.aiworks.fenixcode*`.
- Mobile relying party: `code.iaonline.io`.

## Touched Surfaces

- Web branding defaults and splash alt/ARIA text.
- Desktop runtime environment, Electron custom protocol, Linux URL handler, early
  Linux WM class, product name, and fatal-startup title.
- Mobile Expo app config, navigation schemes, widget deep links, branded title,
  and authorized-client label.
- Marketing release/source links and default layout brand.
- Shared connect authorization default hosted URL.

## Intentional Non-Changes

- `LICENSE` remains upstream MIT and unchanged.
- `ATTRIBUTION.md` remains the Fenix fork attribution anchor.
- Workspace package scope `@t3tools/*`, `T3CODE_*` environment variables,
  `t3.json`, and branch prefixes remain compatibility surfaces until reviewed
  migration work.
- Mobile App Store and Play Store links remain cataloged, not rebranded, until a
  signed Fenix mobile-store release exists.
- Legal/privacy/security copy remains cataloged, not rewritten in this code
  candidate.
- Clerk test domains remain fixture endpoints unless the real Fenix Clerk
  project is configured.

## Verification Notes

- `git diff --check` passed.
- Full dependency/test execution is deferred because this checkout has no
  `node_modules`, upstream requires Node `^24.13.1`, and the host should preserve
  disk before any `vp i` install.
