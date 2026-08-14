# Fenix Code mobile login gate

Date: 2026-08-14

## Access contract

- The native app does not mount navigation, projects, terminals, local folders,
  shares or deep-link routes until the Fenix backend validates the mobile device
  credential.
- A mobile device is enrolled only by scanning the one-time QR generated from an
  authenticated Fenix Code setup page.
- The QR authority must match the configured Fenix portal origin exactly. Generic
  environment pairing QR codes are rejected by the root access gate.
- The resulting device credential is stored in the operating-system secure store
  with device-only, unlocked access.
- Authorization is revalidated every 60 seconds and whenever the app returns to
  the foreground. Missing credentials, malformed local state and network errors
  keep the app locked. HTTP 401/403 clears the rejected credential and requires a
  new authenticated pairing.
- Remote targets remain restricted to the same Fenix owner and tenant, and must
  advertise `local_runner`, `rpc` and `workspace.local` capabilities.

## Verification

- Mobile tests: `102 files / 632 tests / 0 failed`.
- Focused access tests: missing credential, valid credential and HTTP 401/403
  revocation all PASS.
- Mobile TypeScript check: PASS.
- Changed-file formatting and lint: PASS.
- Visible branding guard, branding selftest, inventory selftest and inventory
  check: PASS.
- Automated review of the tracked diff: zero findings. The review service stalled
  when the new screen was first added; the final committed range must be reviewed
  again before publication.

## Distribution boundary

The source, tests and platform exports are ready, but a customer-installable iOS
or Android release still requires AIWorks-owned signing material and store access:
Apple distribution/TestFlight for iOS, and Google Play or an approved signed APK
lane for Android. No inherited signing account, application identifier or update
service is used as a fallback.
