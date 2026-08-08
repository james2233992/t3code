# Fenix Code F0 Bootstrap

Date: 2026-08-08

## Current State

- Fork remote exists: `https://github.com/james2233992/t3code`.
- Upstream remote configured locally: `https://github.com/pingdotgg/t3code.git`.
- Local working directory: `/Users/juancarlosalonsonolasco-macmini2/Proyectos/Fenix-Code`.
- Base upstream commit: `8101cd044911c7dc2a2adf7c7a9ba7962abf57b6`.
- Upstream license: MIT.
- No runtime rebrand has been applied yet.

## F0 Order

1. Preserve `LICENSE` and keep `ATTRIBUTION.md`.
2. Review `docs/fenix/branding-inventory.md` and generated appendices.
3. Build a central branding layer before replacing strings/assets.
4. Repoint or disable hosted app, relay, update, Clerk, analytics, support, and legal endpoints before any runtime release.
5. Build server, web, and desktop using upstream tooling.
6. Run BYOS spike with at least two real provider CLIs, proving subscription tokens stay local to the user machine.
7. Freeze F0 candidate and ask Fable for exact-head review before F1.

## Non-Goals In F0

- No mobile store build/signing.
- No production deployment.
- No Fenix monorepo code changes.
- No rewrite of T3 Code orchestration, provider, checkpoint, permission, WebSocket/RPC, or client runtime core.

## Known Constraints

- The current machine has limited local disk. Dependency installation and desktop builds should be preceded by `df -h` and cleaned after use.
- The upstream repo requires Node `^24.13.1` and `pnpm@11.10.0`; `vp i` is the documented install path.
- Tests/docs contain many expected T3 strings. A successful Fenix rebrand must distinguish runtime leaks from intentional compatibility fixtures.
