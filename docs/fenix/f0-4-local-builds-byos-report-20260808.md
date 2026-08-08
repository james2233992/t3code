# F0.4 Local Builds + BYOS Spike Report

Date: 2026-08-08, Atlantic/Canary.

Authorization:

```yaml
GO_F0_4_LOCAL_BUILDS: AUTORIZADO (local, sin produccion)
```

Repository state:

- Repository: `james2233992/t3code` fork, local checkout `/Users/juancarlosalonsonolasco-macmini2/Proyectos/Fenix-Code`.
- Branch: `codex/fenix-code-f0-4-local-builds-20260808`.
- Base/head during this report: `b5ec76ce38f2`, merge commit for PR #1 over head `cecac0734e3cce2a56585cbca09c312bce7de241`.
- Scope: local validation only. No production systems were touched.

## Build Matrix

| Surface            | Command                              | Result       | Evidence                                                                                                                                         |
| ------------------ | ------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server / Node WS   | `vp run --filter t3 build`           | PASS         | `tsdown` completed, development icon overrides applied, web app bundled into `dist/client`, exit 0.                                              |
| Web / React        | `vp run --filter @t3tools/web build` | PASS         | Vite transformed 4461 modules and completed in 11.28s, exit 0. Warnings were chunk-size/plugin timing only.                                      |
| Desktop / Electron | `vp run build:desktop`               | PASS         | `vp pack` built `src/main.ts`, `src/preload.ts`, `src/preview-pick-preload.ts`, `src/preview-pip-preload.ts` into `dist-electron/*.cjs`, exit 0. |
| Mobile             | Not in F0.4                          | OUT OF SCOPE | Mobile remains cataloged for later work; no F0.4 build claim is made for it.                                                                     |

## BYOS Providers

The dev runtime was launched with an explicit temporary home directory outside the repository:

```sh
node scripts/dev-runner.ts dev --home-dir "$HOME/.cache/fenix-code-f0-t3"
```

This avoided the real `~/.t3/userdata` state. The temporary runtime was stopped after validation and the temporary directories were removed.

| Provider | CLI/session evidence                                                                                                                                                                      | UI evidence                                                                                                                            | Checkpoint/diff/revert                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | `codex-cli 0.144.6`; `codex login status` reported `Logged in using ChatGPT`.                                                                                                             | Settings showed Codex authenticated, enabled, `ChatGPT Pro 20x Subscription`, models `GPT-5.6-Sol`, `GPT-5.6-Terra`, `GPT-5.6-Luna`.   | Created `tmp/f0-byos-codex.txt` with one line, diff showed exactly one new file, then `Revert to this message` returned the checkout to clean state.  |
| Claude   | `Claude Code 2.1.220`; `claude auth status` reported `loggedIn: true`, `authMethod: claude.ai`, `apiProvider: firstParty`, email `juancarlosalonsonolasco@gmail.com`, subscription `max`. | Settings showed Claude authenticated, enabled, `Claude Max Subscription`, models `Claude Fable 5`, `Claude Opus 5`, `Claude Sonnet 5`. | Created `tmp/f0-byos-claude.txt` with one line, diff showed exactly one new file, then `Revert to this message` returned the checkout to clean state. |

Provider switching behavior was also checked: switching an existing Codex thread to Claude is blocked by design with `Claude is unavailable in this thread. Start a new thread to switch providers.` A new thread was used for the Claude smoke.

Captured evidence:

- [Provider settings](./evidence/f0-4-20260808/f0-providers-codex-claude.png)
- [Codex clean diff](./evidence/f0-4-20260808/f0-codex-clean-diff.png)
- [Claude clean diff](./evidence/f0-4-20260808/f0-claude-clean-diff.png)

## Runtime Endpoint Check

Observed runtime logs from the temporary F0.4 sandbox were searched for external T3/Fenix hosted domains:

```sh
rg -n 't3\.codes|app\.t3\.codes|clerk\.t3\.codes|code\.iaonline\.io|iaonline\.io' \
  "$HOME/.cache/fenix-code-f0-t3/userdata/logs" -S
```

Result: no observed calls or log entries for those domains during the F0.4 BYOS smoke.

Source and built runtime bundles were also searched for T3 hosted URLs across server, web, desktop, shared, and contracts code. The remaining non-test runtime-source hits are:

- `packages/contracts/src/t3ProjectFile.ts:10`: `T3_PROJECT_FILE_SCHEMA_URL = "https://t3.codes/schema/t3.json"`.
- `packages/contracts/src/t3ProjectFile.ts:86`: schema description points to `https://t3.codes` documentation.

These are embedded schema/documentation URLs, not observed network calls in the F0.4 runtime. They remain a brand/domain residual for Fable review.

Additional runtime-adjacent checks:

- Desktop update code disables automatic updates in dev/non-packaged mode or when no feed config exists.
- Desktop telemetry path reviewed is local stream/IPC publication, not a T3 hosted endpoint call.

## Residual Findings For Fable

1. Header accessibility/visual residual: Playwright snapshots still expose the main logo as `img "T3"` followed by `Code` in the header link. The app starts and BYOS works, but the accessible logo label is not fully Fenix-branded.
2. Schema/documentation residual: `packages/contracts/src/t3ProjectFile.ts` still embeds `https://t3.codes/schema/t3.json` and text saying `See https://t3.codes for documentation.`
3. Mobile remains explicitly outside F0.4. Separate mobile source still has legacy T3 marketing/legal defaults in indexed results, but no F0.4 mobile claim is made.

## Disk And State Hygiene

- Temporary runtime home: `$HOME/.cache/fenix-code-f0-t3`, removed after the smoke.
- Temporary Playwright working directory: `$HOME/.cache/fenix-code-f0-playwright`, removed after captures were copied.
- Real tool/application state was not cleaned or modified: Cursor, Claude, Codex, and live `~/.t3/userdata` were left untouched.
- Disk after cleanup: 22 GiB free on `/System/Volumes/Data`.
- Checkpoint smoke files were reverted through the app UI; final working tree before this report only contained the report/evidence additions.

## Conclusion

F0.4 execution is locally green for the three requested surfaces and BYOS smoke with Codex and Claude:

- Server build: PASS.
- Web build: PASS.
- Desktop build: PASS.
- BYOS Codex: PASS, including session, diff, and revert.
- BYOS Claude: PASS, including session, diff, and revert.
- Runtime observed-calls check: PASS for no observed T3 hosted calls during the smoke.

F0 should still go through Fable review before closure because two residual brand/domain items remain: the header `img "T3"` label and the embedded `t3.codes` schema/documentation URL.
