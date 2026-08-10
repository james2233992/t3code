# Fenix Code F1.2c Bridge E2E Report - 2026-08-10

## Scope

Owner-relay token: `GO_CANDIDATO_C`.

This report covers the final F1.2c local bridge E2E candidate. It is local-only:

- no production endpoint is called;
- no real provider is invoked;
- repository defaults remain fail-closed;
- Code Lab is enabled only inside the temporary local harness;
- the ChatModels execution service is a fake contract-valid response.

The E2E runner is `scripts/fenix/f1-2c-bridge-e2e.mjs`.

## Local Inputs

- Fenix Code base: `main@2cb804031d5ccf822a34cf13a56edf47c52c8860`.
- Monorepo selected source root: `/Users/juancarlosalonsonolasco-macmini2/Proyectos/Fenix-codelab-companion-credential-20260808`.
- Monorepo `origin/main`: `4d4ff3b804746805eb41d347145279c945399734`.
- The monorepo files compiled by the harness have no diff against `origin/main`:
  - `AIworks_2024_Net/AIWork_API/Services/CodeLab/CodeLabControlPlane.cs`
  - `AIworks_2024_Net/AIWork_API/Services/CodeLab/CodeLabControlPlaneOptions.cs`
  - `AIworks_2024_Net/AIWork_API/Services/ChatModels/FenixCodeChatModelsService.cs`

The runner builds a temporary ASP.NET API outside the repo from those monorepo source files, then exercises the real Fenix Code bridge and adapter in-process. The adapter still resolves the trusted URL as `https://iaonline.io/api/v1/ChatModels/SendMessageWithOptions`; the test transport maps that trusted request to the loopback API only inside the harness.

## Command

```bash
FENIX_MONOREPO_ROOT="/Users/juancarlosalonsonolasco-macmini2/Proyectos/Fenix-codelab-companion-credential-20260808" \
  node scripts/fenix/f1-2c-bridge-e2e.mjs
```

Output transcript SHA-256 from the recorded run:

```text
daafee178ed9e2958c33c9f3ee4f476e542ffaa7096da163fc3f6eb33a58ef6b  /tmp/fenix-code-f1-2c-e2e-output-postcommit.json
```

## Results

| Check                         | Result                                                                |
| ----------------------------- | --------------------------------------------------------------------- |
| Local monorepo API harness    | PASS, loopback only                                                   |
| Pair device                   | PASS                                                                  |
| Device credential file        | PASS, regular file `0600`, outside repo                               |
| Fenix credential envelope     | PASS, bearer, `https://iaonline.io`, scope `fenix.chatmodels.generic` |
| Bridge snapshot               | PASS, tenant scope `companyId=17`, `userId=29`                        |
| `startSession` -> `sendTurn`  | PASS                                                                  |
| `POST SendMessageWithOptions` | PASS, stable contract `fenix-code-chatmodels.v1`                      |
| Malformed payload             | PASS, `400 FENIX_CODE_INVALID_REQUEST`                                |
| Expired credential window     | PASS, snapshot null before send                                       |
| Unknown provider bucket       | PASS, first 20 requests `400`, request 21 `429`                       |
| Owner mismatch revocation     | PASS, adapter fails cleanly before ChatModels; zero ChatModels calls  |
| Cleanup                       | PASS, local dotnet process terminated; no process left alive          |

Harness counters:

```json
{
  "pairings": 1,
  "fenixCredentialIssues": 26,
  "chatRequests": 23,
  "serviceCalls": 1,
  "ownerMismatchRevocations": 1
}
```

## Sanitized Transcript Excerpts

Happy path request:

```json
{
  "trustedUrl": "https://iaonline.io/api/v1/ChatModels/SendMessageWithOptions",
  "loopbackUrl": "http://127.0.0.1:<port>/api/v1/ChatModels/SendMessageWithOptions",
  "request": {
    "method": "POST",
    "headers": {
      "accept": "application/json",
      "content-type": "application/json",
      "authorization": "***"
    },
    "body": {
      "message": "Construye una respuesta Fenix Code de prueba",
      "model": "groq/openai/gpt-oss-120b",
      "isGenericChatLane": true,
      "source": "fenix-code",
      "threadId": "fenix-e2e-thread",
      "turnId": "<uuid>",
      "requestId": "<same uuid>"
    }
  },
  "response": {
    "status": 200,
    "body": {
      "version": "fenix-code-chatmodels.v1",
      "status": "ok",
      "response": "Respuesta fake Fenix Code local"
    }
  }
}
```

Negative outcomes:

```json
{
  "malformedPayload": {
    "status": 400,
    "errorCode": "FENIX_CODE_INVALID_REQUEST",
    "message": "ThreadId is invalid."
  },
  "expiredCredential": "snapshot-null-before-send",
  "unknownProviderRateLimit": {
    "firstTwenty": "400 model_unavailable",
    "requestTwentyOne": 429,
    "bucket": "unknown"
  },
  "ownerMismatchRevocation": {
    "result": "adapter-failed-before-send",
    "chatModelsCalls": 0
  }
}
```

Cleanup:

```json
{
  "dotnetProcessTerminated": true,
  "processStillAlive": false
}
```

## Limits

- This does not enable Fenix Code in production.
- This does not call real providers.
- This does not validate the later provider-execution candidate.
- This does not authorize F1.4, QA F1, deploy, DDL/DML, or production activation.
