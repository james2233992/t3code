# Fenix Code Companion for macOS

The public Companion artifact is a release deliverable. A local unsigned build
must never be copied into `apps/web/public/downloads` or marked available in the
download manifest.

## Required release inputs

- An imported `Developer ID Application` identity.
- `FENIX_CODE_CODESIGN_IDENTITY`, set to that identity's name or SHA-1.
- `APPLE_TEAM_ID`, set to the 10-character Apple Developer Team ID.
- `APPLE_API_KEY`, set to the path of an App Store Connect API private key.
- `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` for that key.
- Optionally, `FENIX_CODE_RELEASE_LABEL` for a stable release label. The default
  is `<version>-pilot.<UTC date>`.

The Companion version lives in
`scripts/fenix/companion-package/VERSION`. Bump it for every artifact offered to
users so an older failed download cannot be confused with the replacement.

## Build

```bash
pnpm dist:companion:macos:arm64
```

The build performs these gates before it writes an available manifest entry:

1. Removes native prebuilds for platforms other than Darwin ARM64.
2. Signs every Mach-O file in the Companion runtime with Developer ID.
3. Verifies the signing Team ID and loads `ffi-rs` with the packaged Node.js
   runtime.
4. Generates the payload checksum inventory after signing.
5. Submits the complete package to Apple and requires an `Accepted`
   notarization result.
6. Creates the tarball and updates the manifest only after every prior gate
   passes.

The installer independently checks payload hashes, native signatures, signing
Team ID, and native-file inventory before it activates a runtime. Do not add
`xattr -d com.apple.quarantine` as a release workaround: quarantine is the
customer-default Gatekeeper path that the signed and notarized package must
pass.

## Acceptance

Keep the generated artifact outside production until all of these checks pass:

```bash
codesign --verify --strict --verbose=2 path/to/native-addon.node
codesign -d --verbose=4 path/to/native-addon.node
```

Then test from a fresh browser download on an Apple Silicon Mac with Gatekeeper
enabled. The acceptance flow is download, install, pair, service install,
project, turn, diff, checkpoint, and revert. A successful build or
notarization result alone is not user acceptance.
