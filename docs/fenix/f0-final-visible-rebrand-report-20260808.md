# F0 Final Visible Rebrand Report

Date: 2026-08-08, Atlantic/Canary.

Repository: `james2233992/t3code` fork, local checkout `/Users/juancarlosalonsonolasco-macmini2/Proyectos/Fenix-Code`.

Branch: `codex/fenix-code-f0-4-local-builds-20260808`.

Scope: local F0-final closeout only. No production systems were touched.

## Scope Applied

- User-visible product strings were rebranded to `Fenix Code`, `Fenix Connect`, or AIWorks/Fenix wording across server, web, desktop, mobile, marketing, relay, shared contracts, and scripts.
- T3-hosted external domains were replaced with Fenix-owned or neutral domains. The project-file schema URL now points at `https://iaonline.io/schema/t3.json`.
- The web sidebar no longer renders the upstream T3 wordmark. It renders the configured `APP_BASE_NAME` as visible text and exposes `Go to Fenix Code threads` to accessibility tooling.
- The root web splash/title changed from `T3 Code (Alpha)` to `Fenix Code (Alpha)`.
- Upstream testimonials were not rewritten into Fenix testimonials. `apps/marketing/src/lib/tweets.ts` is intentionally empty until Fenix-owned quotes exist, and the endorsements section is hidden when there are no entries.

## Intentionally Preserved Internals

The following internal identifiers remain unchanged for upstream rebase compatibility:

- `T3ProjectFile`
- `T3_PROJECT_FILE_NAME`
- `t3ProjectFile.ts`
- `@t3tools/*`
- `t3.json`
- `T3CODE_HOME`

These are not treated as F0 visible-branding defects. The `t3.json` filename is deferred to the client-facing configuration phase.

## Guardrails Added

- `scripts/fenix/check-visible-branding.sh` fails on visible T3 strings and hosted T3 domains in live source, including `apps/web/index.html`.
- `.github/workflows/fenix-fork-ci.yml` now runs:
  - `bash scripts/fenix/generate-branding-inventory.sh selftest`
  - `bash scripts/fenix/generate-branding-inventory.sh check`
  - `bash scripts/fenix/check-visible-branding.sh`
- `docs/fenix/branding-inventory.md` records the visible-vs-internal split.

## Validation

Full validation was rerun after the final splash/title and testimonial adjustments:

```sh
vp fmt
bash scripts/fenix/generate-branding-inventory.sh generate
bash scripts/fenix/generate-branding-inventory.sh selftest
bash scripts/fenix/generate-branding-inventory.sh check
bash scripts/fenix/check-visible-branding.sh
vp check
vpr typecheck
vp run test
```

Result:

- Format: PASS, 2497 files.
- Branding inventory selftest/check: PASS.
- Visible branding guard: PASS.
- Lint/check: PASS, 2367 files.
- Typecheck: PASS with existing Effect suggestions only.
- Test suite: PASS, 213 files passed, 2 skipped; 1946 tests passed, 7 skipped in the server tranche, with all earlier package/app tranches green.

Builds:

```sh
vp run --filter t3 build:bundle
vp run build:desktop
```

Result:

- Server bundle: PASS.
- Web build: PASS, bundled as part of `build:desktop`.
- Desktop Electron build: PASS.

## Visual Evidence

The dev runtime was launched with an explicit temporary home directory:

```sh
node scripts/dev-runner.ts dev --home-dir "$HOME/.cache/fenix-code-f0-final-t3"
```

The real `~/.t3/userdata` was not touched. The temporary runtime was paired through the local pairing URL, captured, stopped, and removed.

Evidence:

- [F0 final header screenshot](./evidence/f0-final-20260808/f0-final-header-fenix-code.png)

Observed DOM:

- `document.title`: `Fenix Code (Dev)`
- Header link: `Go to Fenix Code threads`
- Visible brand text: `Fenix` / `Code`

## Runtime Domain Status

F0.4 already certified no observed runtime calls to T3-hosted domains during the BYOS smoke. F0-final removes the source-level hosted-domain residuals found in that report. The remaining T3 references are internal compatibility identifiers or tests that assert legacy paths remain readable.

## Disk And State Hygiene

- Temporary runtime home removed: `$HOME/.cache/fenix-code-f0-final-t3`.
- Temporary Playwright working directory removed: `$HOME/.cache/fenix-code-f0-final-playwright`.
- Local Playwright scratch output removed after copying the evidence screenshot.
- Cursor, Claude, Codex, and live user app state were not modified.
- Disk after cleanup: 19 GiB free on `/System/Volumes/Data`.

## Conclusion

F0-final visible rebrand is locally green:

- Visible T3 branding guard: PASS.
- T3 hosted-domain guard: PASS.
- Web header/title evidence: PASS.
- Server, web, desktop builds: PASS.
- Full test pipeline: PASS.

F1 remains blocked until Fable reviews and accepts this exact head as the F0 closeout.
