# Fenix Code Attribution

Fenix Code is a fork of the upstream `pingdotgg/t3code` project.

- Upstream repository: https://github.com/pingdotgg/t3code
- Fork repository: https://github.com/james2233992/t3code
- Base upstream commit: `8101cd044911c7dc2a2adf7c7a9ba7962abf57b6`
- Base commit date: 2026-08-08T03:59:04-07:00
- Base commit subject: `feat(usage): usage page reading provider transcripts across environments (#5684)`
- License: MIT License

The upstream `LICENSE` file is preserved intact. Copyright notices and third-party
notices must remain with copied or redistributed portions of the software.

Fenix-specific changes are intended to stay rebase-friendly and isolated to:

- Fenix branding configuration, theme, and assets.
- The additive Fenix provider driver.
- The pairing bridge to the existing Fenix Code Lab surface.

Runtime behavior that belongs to the upstream core, including orchestration,
provider subprocess boundaries, checkpointing, permission modes, and local
subscription token handling, should remain aligned with upstream unless a
reviewed Fenix bridge requires an adapter-layer change.
