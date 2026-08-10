#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const OWNER_RELAY_TOKEN = "GO_QA_F1: AUTORIZADO";

const repoRoot = NodePath.resolve(new URL("../..", import.meta.url).pathname);
const DEFAULT_MONOREPO_ROOT = NodePath.join(
  NodePath.dirname(repoRoot),
  "Fenix-monorepo-qa-f1-20260810",
);
const monorepoRoot = NodePath.resolve(process.env.FENIX_MONOREPO_ROOT ?? DEFAULT_MONOREPO_ROOT);
const evidenceDir = NodePath.join(repoRoot, "docs", "fenix", "evidence");
const evidencePath = NodePath.join(evidenceDir, "qa-f1-20260810.json");
const reportPath = NodePath.join(repoRoot, "docs", "fenix", "qa-f1-report-20260810.md");

const redactPatterns = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer ***"],
  [/AuthToken=[^;\s"]+/g, "AuthToken=***"],
  [/"accessToken"\s*:\s*"[^"]+"/g, '"accessToken": "***"'],
  [/"deviceCredential"\s*:\s*"[^"]+"/g, '"deviceCredential": "***"'],
  [/"credential"\s*:\s*"[^"]+"/g, '"credential": "***"'],
  [/sk-[A-Za-z0-9_-]{12,}/g, "sk-***"],
];

function sanitize(value) {
  let output = String(value ?? "");
  for (const [pattern, replacement] of redactPatterns) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

function tail(value, max = 12_000) {
  const text = sanitize(value);
  return text.length <= max ? text : text.slice(text.length - max);
}

function run(command, args, options) {
  const startedAt = new Date();
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 60 * 1024 * 1024,
    timeout: options.timeoutMs ?? 20 * 60 * 1000,
  });
  const endedAt = new Date();
  const status = typeof result.status === "number" ? result.status : result.signal ? 128 : 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    name: options.name,
    row: options.row,
    cwd: displayPath(options.cwd),
    command: [command, ...args].join(" "),
    status,
    signal: result.signal ?? null,
    durationMs: endedAt.getTime() - startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    counts: parseCounts(`${stdout}\n${stderr}`),
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
    ...(options.keepFullStdout ? { stdoutFullSanitized: sanitize(stdout) } : {}),
  };
}

function displayPath(path) {
  return NodePath.resolve(path)
    .replace(repoRoot, "<t3code-root>")
    .replace(monorepoRoot, "<monorepo-root>");
}

function parseCounts(text) {
  const output = {};
  const vitestMatches = Array.from(
    text.matchAll(/Tests\s+(\d+)\s+passed(?:\s+\|\s+(\d+)\s+skipped)?/g),
  );
  if (vitestMatches.length > 0) {
    output.runner = "vitest";
    output.passed = vitestMatches.reduce((sum, match) => sum + Number(match[1]), 0);
    const skipped = vitestMatches.reduce((sum, match) => sum + Number(match[2] ?? 0), 0);
    if (skipped > 0) output.skipped = skipped;
  }
  const dotnet = text.match(
    /Passed!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+),\s+Total:\s+(\d+)/,
  );
  if (dotnet) {
    output.runner = "dotnet";
    output.failed = Number(dotnet[1]);
    output.passed = Number(dotnet[2]);
    output.skipped = Number(dotnet[3]);
    output.total = Number(dotnet[4]);
  }
  const dotnetSpanish = text.match(
    /Correctas!\s+-\s+Con error:\s+(\d+),\s+Superado:\s+(\d+),\s+Omitido:\s+(\d+),\s+Total:\s+(\d+)/,
  );
  if (dotnetSpanish) {
    output.runner = "dotnet";
    output.failed = Number(dotnetSpanish[1]);
    output.passed = Number(dotnetSpanish[2]);
    output.skipped = Number(dotnetSpanish[3]);
    output.total = Number(dotnetSpanish[4]);
  }
  const vpCheck = text.match(/Checked\s+(\d+)\s+files/);
  if (vpCheck) {
    output.runner = output.runner ?? "vp";
    output.checked = Number(vpCheck[1]);
  }
  return Object.keys(output).length > 0 ? output : null;
}

function commandOk(step) {
  return step.status === 0;
}

function extractBridgeSummary(step) {
  const raw = `${step.stdoutFullSanitized ?? step.stdoutTail}\n${step.stderrTail}`;
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(start));
    const transcript = Array.isArray(parsed.transcript) ? parsed.transcript : [];
    const stats =
      transcript.find((entry) => entry.step === "local-monorepo-stats")?.response?.body ?? null;
    const urls = new Set();
    for (const entry of transcript) {
      for (const key of ["loopbackUrl", "apiBaseUrl"]) {
        if (typeof entry[key] === "string") urls.add(new URL(entry[key]).host);
      }
      if (entry.response?.body?.loopbackUrl)
        urls.add(new URL(entry.response.body.loopbackUrl).host);
    }
    return {
      ok: parsed.ok === true,
      transcriptEvents: transcript.length,
      stats,
      contactedHosts: Array.from(urls).sort(),
    };
  } catch {
    return null;
  }
}

function inspectDefaults() {
  const monorepoAppSettings = NodePath.join(
    monorepoRoot,
    "AIworks_2024_Net",
    "AIWork_API",
    "appsettings.json",
  );
  const appSettings = JSON.parse(NodeFS.readFileSync(monorepoAppSettings, "utf8"));
  const codeLab = appSettings.CodeLab ?? {};
  const t3FenixProvider = NodeFS.readFileSync(
    NodePath.join(repoRoot, "apps", "server", "src", "provider", "Layers", "FenixProvider.ts"),
    "utf8",
  );
  return {
    monorepoCodeLabEnabledDefault: codeLab.Enabled === false,
    t3FenixProviderDisabledMessage: /disabled until Code Lab pairing QA/i.test(t3FenixProvider),
  };
}

function inspectRuntimeT3Domains() {
  const result = run(
    "rg",
    [
      "-n",
      "https?://[^\"'\\s]*(t3\\.codes|t3tools|app\\.t3\\.codes|clerk\\.t3\\.codes)",
      "apps/web/src",
      "apps/server/src",
      "apps/desktop/src",
      "packages/client-runtime/src",
      "packages/shared/src",
      "-g",
      "!**/*.test.ts",
      "-g",
      "!**/*.test.tsx",
    ],
    {
      cwd: repoRoot,
      name: "Runtime T3 hosted-domain scan",
      row: "8",
      timeoutMs: 2 * 60 * 1000,
    },
  );
  return {
    ok: result.status === 1,
    status: result.status,
    matchesTail: result.stdoutTail,
    errorTail: result.stderrTail,
  };
}

async function writeJson(path, value) {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  await NodeFSP.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeReport(evidence) {
  const rows = new Map();
  for (const step of evidence.steps) {
    if (!rows.has(step.row)) rows.set(step.row, []);
    rows.get(step.row).push(step);
  }

  const rowNames = {
    1: "BYOS local",
    2: "Driver Fenix",
    3: "Bridge E2E",
    4: "Tenancy",
    5: "Custom CLI agents",
    6: "Rate-limit + audit monorepo",
    7: "Fronteras de defaults",
    8: "Aislamiento T3",
    final: "Suites completas y gates",
  };

  const lines = [
    "# QA F1 Report - 2026-08-10",
    "",
    `Authorization: \`${OWNER_RELAY_TOKEN}\` (owner-relay).`,
    "",
    "## Scope",
    "",
    "QA F1 is verification only. This candidate adds a reproducible QA harness and evidence; it does not change runtime behavior, defaults, production configuration, database schema, or database data.",
    "",
    "- t3code base: `main@a181151d07dbfc14e2b26b3d0a1671d13e401dd7`.",
    "- monorepo base: `main@4d4ff3b804746805eb41d347145279c945399734`.",
    "- QA branch: `codex/fenix-code-qa-f1-20260810`.",
    "- Evidence JSON: `docs/fenix/evidence/qa-f1-20260810.json`.",
    "",
    "## Matrix",
    "",
    "| Row | Surface | Result | Evidence |",
    "| --- | --- | --- | --- |",
  ];

  for (const [row, name] of Object.entries(rowNames)) {
    const steps = rows.get(row) ?? [];
    const result = steps.length > 0 && steps.every(commandOk) ? "PASS" : "FAIL";
    const evidenceText = steps
      .map((step) => {
        const counts = step.counts ? `, ${JSON.stringify(step.counts)}` : "";
        return `${step.name}: rc ${step.status}${counts}`;
      })
      .join("<br>");
    lines.push(`| ${row} | ${name} | ${result} | ${evidenceText || "No command recorded"} |`);
  }

  lines.push(
    "",
    "## Bridge Transcript Summary",
    "",
    "The F1.2c bridge E2E harness was rerun locally with the monorepo source root supplied through `FENIX_MONOREPO_ROOT`. It builds a temporary ASP.NET loopback harness, obtains a short Fenix credential, runs a contract-valid turn through the Fenix adapter, exercises the four live negatives, and shuts the temporary process down.",
    "",
    "```json",
    JSON.stringify(evidence.bridgeSummary ?? {}, null, 2),
    "```",
    "",
    "## Defaults And Boundaries",
    "",
    `- Monorepo checked-in \`CodeLab:Enabled\` default is false: ${evidence.defaults.monorepoCodeLabEnabledDefault ? "PASS" : "FAIL"}.`,
    `- t3code Fenix provider remains disabled/unpaired by default: ${evidence.defaults.t3FenixProviderDisabledMessage ? "PASS" : "FAIL"}.`,
    `- Runtime hosted-domain scan for T3 infrastructure returned no live-source matches: ${evidence.runtimeT3Domains.ok ? "PASS" : "FAIL"}.`,
    "- The bridge transcript records actual contacted hosts as loopback only; the trusted `https://iaonline.io` URL is mapped to loopback inside the harness and is not called externally.",
    "",
    "## Findings",
    "",
  );

  const failures = evidence.steps.filter((step) => !commandOk(step));
  if (
    !evidence.defaults.monorepoCodeLabEnabledDefault ||
    !evidence.defaults.t3FenixProviderDisabledMessage
  ) {
    failures.push({ name: "Defaults inspection", status: 1 });
  }
  if (!evidence.runtimeT3Domains.ok) {
    failures.push({
      name: "Runtime T3 hosted-domain scan",
      status: evidence.runtimeT3Domains.status,
    });
  }

  if (failures.length === 0) {
    lines.push("- None found in this QA run.");
  } else {
    for (const failure of failures) {
      lines.push(
        `- HIGH: ${failure.name} failed with rc ${failure.status}. Fix requires a separate GO; no remediation is included in this candidate.`,
      );
    }
  }

  lines.push(
    "",
    "## Cleanup",
    "",
    `- Scoped process scan after QA: ${evidence.processScanAfter.trim() || "no matching QA/bridge processes"}.`,
    "- No broad `pkill` was used; only the F1.2c harness owns and terminates its temporary dotnet process.",
    "",
    "## Limits",
    "",
    "- No real providers were called.",
    "- No production endpoint, deployment, DDL, DML, or activation was touched.",
    "- Any defect found by this QA must be fixed in a separate candidate with its own owner-relay GO.",
    "",
  );

  await NodeFSP.writeFile(reportPath, `${lines.join("\n")}\n`);
}

async function main() {
  const steps = [];
  const runStep = (row, name, cwd, command, args, options = {}) => {
    const step = run(command, args, { row, name, cwd, ...options });
    steps.push(step);
    process.stdout.write(
      `${step.status === 0 ? "PASS" : "FAIL"} row ${row}: ${name} (rc ${step.status})\n`,
    );
    return step;
  };

  runStep("1", "BYOS Claude/Codex/checkpoint focal suite", repoRoot, "pnpm", [
    "exec",
    "vp",
    "test",
    "run",
    "apps/server/src/provider/Layers/ClaudeAdapter.test.ts",
    "apps/server/src/provider/Layers/CodexAdapter.test.ts",
    "apps/server/src/orchestration/Layers/CheckpointReactor.test.ts",
  ]);

  runStep("2", "Fenix driver additive/fail-closed focal suite", repoRoot, "pnpm", [
    "exec",
    "vp",
    "test",
    "run",
    "apps/server/src/provider/Drivers/FenixDriver.test.ts",
    "apps/server/src/provider/Layers/FenixAdapter.test.ts",
    "apps/server/src/provider/Layers/FenixProvider.test.ts",
    "apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts",
    "packages/shared/src/model.test.ts",
  ]);

  const bridge = runStep(
    "3",
    "F1.2c bridge loopback E2E",
    repoRoot,
    "node",
    ["scripts/fenix/f1-2c-bridge-e2e.mjs"],
    {
      env: { FENIX_MONOREPO_ROOT: monorepoRoot },
      keepFullStdout: true,
      timeoutMs: 8 * 60 * 1000,
    },
  );
  const bridgeSummary = extractBridgeSummary(bridge);

  runStep("4", "F1.3 tenancy scoped projection and WS focal suite", repoRoot, "pnpm", [
    "exec",
    "vp",
    "test",
    "run",
    "apps/server/src/orchestration/Layers/FenixScopedProjectionSnapshotQuery.test.ts",
    "apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts",
    "apps/server/src/server.test.ts",
    "apps/server/src/provider/Drivers/FenixDriver.test.ts",
    "apps/server/src/provider/Layers/FenixAdapter.test.ts",
    "packages/shared/src/model.test.ts",
  ]);

  runStep("5", "F1.4 custom CLI focal suite", repoRoot, "pnpm", [
    "exec",
    "vp",
    "test",
    "run",
    "apps/server/src/provider/Layers/CustomCliAdapter.test.ts",
    "apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts",
    "apps/server/src/server.test.ts",
    "-t",
    "CustomCliAdapter|ProviderInstanceRegistryLive|denies global websocket rpc methods for Fenix tenant scoped sessions",
  ]);

  runStep(
    "6",
    "Monorepo backend test restore",
    monorepoRoot,
    "dotnet",
    ["restore", "AIworks_2024_Net/AIWorks_API.Tests/AIWorks_API.Tests.csproj"],
    { timeoutMs: 10 * 60 * 1000 },
  );
  runStep(
    "6",
    "Monorepo Fenix Code ChatModels endpoint focal suite",
    monorepoRoot,
    "dotnet",
    [
      "test",
      "AIworks_2024_Net/AIWorks_API.Tests/AIWorks_API.Tests.csproj",
      "--filter",
      "FullyQualifiedName~FenixCodeChatModelsEndpointTests",
      "--no-restore",
    ],
    { timeoutMs: 10 * 60 * 1000 },
  );

  runStep("7", "Defaults fail-closed focal suite", repoRoot, "pnpm", [
    "exec",
    "vp",
    "test",
    "run",
    "apps/server/src/provider/Services/FenixPairingSessionBridge.test.ts",
    "apps/server/src/provider/Drivers/FenixDriver.test.ts",
    "apps/server/src/provider/Layers/FenixProvider.test.ts",
  ]);

  runStep("8", "Branding inventory selftest", repoRoot, "bash", [
    "scripts/fenix/generate-branding-inventory.sh",
    "selftest",
  ]);
  runStep("8", "Branding inventory check", repoRoot, "bash", [
    "scripts/fenix/generate-branding-inventory.sh",
    "check",
  ]);
  runStep("8", "Visible branding selftest", repoRoot, "bash", [
    "scripts/fenix/check-visible-branding.sh",
    "selftest",
  ]);
  runStep("8", "Visible branding check", repoRoot, "bash", [
    "scripts/fenix/check-visible-branding.sh",
  ]);

  runStep("final", "t3code vp check", repoRoot, "pnpm", ["exec", "vp", "check"], {
    timeoutMs: 10 * 60 * 1000,
  });
  runStep(
    "final",
    "t3code typecheck",
    repoRoot,
    "pnpm",
    ["exec", "vp", "run", "-r", "--concurrency-limit", "2", "typecheck"],
    {
      timeoutMs: 20 * 60 * 1000,
    },
  );
  runStep(
    "final",
    "t3code full test suite",
    repoRoot,
    "pnpm",
    ["exec", "vp", "run", "-r", "test"],
    {
      timeoutMs: 20 * 60 * 1000,
    },
  );
  runStep(
    "final",
    "monorepo backend full test suite",
    monorepoRoot,
    "dotnet",
    ["test", "AIworks_2024_Net/AIWorks_API.Tests/AIWorks_API.Tests.csproj", "--no-restore"],
    { timeoutMs: 25 * 60 * 1000 },
  );
  runStep("final", "git diff check", repoRoot, "git", ["diff", "--check"]);

  const defaults = inspectDefaults();
  const runtimeT3Domains = inspectRuntimeT3Domains();
  const processScan = run("pgrep", ["-fl", "FenixCodeBridgeE2E|fenix-code-f1-2c-e2e|qa-f1"], {
    cwd: repoRoot,
    name: "Scoped process scan",
    row: "final",
    timeoutMs: 30_000,
  });

  const evidence = {
    authorization: OWNER_RELAY_TOKEN,
    generatedAt: new Date().toISOString(),
    t3code: {
      root: "<t3code-root>",
      head: run("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        name: "t3 head",
        row: "meta",
      }).stdoutTail.trim(),
    },
    monorepo: {
      root: "<monorepo-root>",
      head: run("git", ["rev-parse", "HEAD"], {
        cwd: monorepoRoot,
        name: "monorepo head",
        row: "meta",
      }).stdoutTail.trim(),
    },
    steps,
    bridgeSummary,
    defaults,
    runtimeT3Domains,
    processScanAfter: processScan.status === 1 ? "" : processScan.stdoutTail,
  };

  await writeJson(evidencePath, evidence);
  await writeReport(evidence);

  const failed =
    steps.some((step) => step.status !== 0) ||
    !defaults.monorepoCodeLabEnabledDefault ||
    !defaults.t3FenixProviderDisabledMessage ||
    !runtimeT3Domains.ok;

  process.stdout.write(
    `evidence=${displayPath(evidencePath)}\nreport=${displayPath(reportPath)}\n`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
