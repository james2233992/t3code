# Fenix Code F1 Driver

Date: 2026-08-08, Atlantic/Canary.

Repository: `james2233992/t3code` fork.

## F1.1 Driver Contract

- Driver kind: `fenix`.
- Default state: disabled until pairing QA is complete.
- Backend lane: Fenix ChatModels only:
  - Catalog: `GET https://iaonline.io/api/v1/ChatModels`
  - Turn execution: `POST https://iaonline.io/api/v1/ChatModels/SendMessageWithOptions`
  - Request marker: `isGenericChatLane: true`
- Forbidden lane: no direct `run_on_models` access, no new API key, and no third-party catalog in Fenix Code.

## Featured Programming Agent

The featured model is `groq/openai/gpt-oss-120b` for `Agente Groq de Programacion`.
Legacy stored selections using `openai/gpt-oss-120b` are accepted as input and
canonicalized before any server payload is built.

Fable review notes this is already present in the production Fenix catalog as run_on `14`, used by QA agent `234`. F1 therefore does not require a new `run_on_models` row or DML. The documented catalog economics for this driver are `$0.15` input / `$0.60` output per 1M tokens with `131k` context.

## F1.2 Pairing Bridge State

Fenix Code now fails closed unless the Fenix adapter receives an active paired Fenix session. The adapter accepts a runtime-injected pairing session as either:

- cookie-first session: an exact `AuthToken` value, used to build `Cookie: AuthToken=...`
- bearer session: `Authorization: Bearer ...`

Pairing credentials are only attached to requests whose resolved origin is exactly `https://iaonline.io`. The adapter rejects malformed cookie and bearer values before fetch, including control characters or multi-cookie input.

The Fenix driver now resolves a short-lived credential snapshot through the
runtime `FenixPairingSessionBridge` service and injects the active session into
the adapter on each turn. The bridge contract returns an envelope with an
explicit `expiresAtEpochMs`; Fenix Code validates that expiry in one central
helper before exposing any cookie or bearer value to the adapter. Missing,
non-finite, unsafe, expired, or near-expiry metadata is treated as unpaired.

The production default bridge is deliberately unpaired, so an enabled Fenix
provider cannot reach `iaonline.io` until the Code Lab pairing bridge supplies
an active Fenix identity envelope. `startSession` never resolves or consumes the
credential; pairing is checked only when an accepted turn is sent. Expired or
unavailable sessions keep the existing adapter fail-closed path: no backend
request is made without a valid pairing session.

The current Fenix monorepo surface inspected for F1.2 is `ChatWorkspaceController` plus `InMemoryChatWorkspacePairingService`. That pairing is currently a boolean per `(companyId, userId)` and does not yet issue a cookie/token envelope consumable by Fenix Code. If production pairing requires changes there, it must be a separate monorepo PR.

## F1.2 Guardrails

- No pairing session: `sendTurn` fails before `fetch`, so the Fenix backend is not reached.
- Invalid/expired pairing envelope: `sendTurn` fails before `fetch`.
- Paired cookie session: `sendTurn` calls the Fenix generic chat lane with `Cookie: AuthToken=<value>` and the standard request body.
- Local driver E2E: a simulated bridge session reaches a mocked
  `ChatModels/SendMessageWithOptions` endpoint, records the turn, and rolls the
  thread back through the standard adapter cycle.
- Resolver discipline: `startSession` resolves zero credentials; each accepted
  `sendTurn` resolves the bridge exactly once.
- Existing upstream drivers remain untouched.
