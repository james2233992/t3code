// @effect-diagnostics-next-line nodeBuiltinImport:off - filesystem permissions and symlink escapes are the behavior under test.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - path traversal fixtures need native path semantics.
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";

import {
  FENIX_COMPANION_CAPABILITIES,
  fenixCompanionConfigPath,
  normalizeFenixPortalOrigin,
  readFenixCompanionConfig,
  requireFenixAllowedCloneSource,
  requireFenixAllowedDestinationPath,
  requireFenixAllowedExistingPath,
  writeFenixCompanionConfig,
} from "./CompanionConfig.ts";

it("advertises the control-plane local runner capability", () => {
  expect(FENIX_COMPANION_CAPABILITIES).toContain("local_runner");
});

async function withFixture(
  run: (fixture: {
    readonly stateDir: string;
    readonly root: string;
    readonly outside: string;
  }) => Promise<void>,
): Promise<void> {
  const base = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fenix-companion-config-"));
  const stateDir = NodePath.join(base, "state");
  const root = NodePath.join(base, "allowed");
  const outside = NodePath.join(base, "outside");
  await Promise.all([
    NodeFSP.mkdir(NodePath.join(root, "repo"), { recursive: true }),
    NodeFSP.mkdir(outside, { recursive: true }),
  ]);
  try {
    await writeFenixCompanionConfig(stateDir, {
      version: 1,
      portalOrigin: "https://iaonline.io",
      deviceId: "device-1234567890",
      deviceName: "Test companion",
      deviceCredential: "credential-123456789012345678901234567890",
      allowedRoots: [root],
    });
    await run({ stateDir, root: await NodeFSP.realpath(root), outside });
  } finally {
    await NodeFSP.rm(base, { recursive: true, force: true });
  }
}

it("stores the companion credential as 0600 and normalizes the portal origin", async () => {
  await withFixture(async ({ stateDir, root }) => {
    const stat = await NodeFSP.stat(fenixCompanionConfigPath(stateDir));
    const config = await readFenixCompanionConfig(stateDir);

    expect(stat.mode & 0o777).toBe(0o600);
    expect(config?.portalOrigin).toBe("https://iaonline.io");
    expect(config?.allowedRoots).toEqual([root]);
    expect(normalizeFenixPortalOrigin("https://iaonline.io/code-lab/")).toBe("https://iaonline.io");
    expect(() => normalizeFenixPortalOrigin("http://example.com")).toThrow(/HTTPS/u);
  });
});

it("allows existing and not-yet-created destinations only below explicit local roots", async () => {
  await withFixture(async ({ stateDir, root, outside }) => {
    await expect(
      requireFenixAllowedExistingPath(stateDir, NodePath.join(root, "repo")),
    ).resolves.toBe(NodePath.join(root, "repo"));
    await expect(
      requireFenixAllowedDestinationPath(stateDir, NodePath.join(root, "new", "clone")),
    ).resolves.toBe(NodePath.join(root, "new", "clone"));
    await expect(requireFenixAllowedExistingPath(stateDir, outside)).rejects.toThrow(/outside/u);
    await expect(
      requireFenixAllowedDestinationPath(stateDir, NodePath.join(outside, "clone")),
    ).rejects.toThrow(/outside/u);
  });
});

it("rejects symlink escapes and unsafe clone transports while preserving local and remote URLs", async () => {
  await withFixture(async ({ stateDir, root, outside }) => {
    const escape = NodePath.join(root, "escape");
    await NodeFSP.symlink(outside, escape);

    await expect(requireFenixAllowedExistingPath(stateDir, escape)).rejects.toThrow(/outside/u);
    await expect(
      requireFenixAllowedCloneSource(stateDir, NodePath.join(root, "repo")),
    ).resolves.toBe(undefined);
    await expect(
      requireFenixAllowedCloneSource(stateDir, `file://${NodePath.join(root, "repo")}`),
    ).resolves.toBe(undefined);
    await expect(requireFenixAllowedCloneSource(stateDir, outside)).rejects.toThrow(/outside/u);
    await expect(requireFenixAllowedCloneSource(stateDir, "ext::sh -c evil")).rejects.toThrow(
      /not allowed/u,
    );
    await expect(
      requireFenixAllowedCloneSource(stateDir, "https://example.com/owner/repo.git"),
    ).resolves.toBe(undefined);
    await expect(
      requireFenixAllowedCloneSource(stateDir, "git@example.com:owner/repo.git"),
    ).resolves.toBe(undefined);
  });
});
