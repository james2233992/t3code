import type { VcsStatusResult } from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";
import {
  buildGitActionProgressStages,
  buildMenuItems,
  requiresDefaultBranchConfirmation,
  resolveAutoFeatureBranchName,
  resolveDefaultBranchActionDialogCopy,
  resolveLiveThreadBranchUpdate,
  resolveQuickAction,
  resolveThreadBranchUpdate,
  resolveThreadBranchMetadataPatch,
} from "./GitActionsControl.logic";

function status(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/test",
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  };
}

describe("when: ref is clean and has an open PR", () => {
  it("resolveQuickAction opens the existing PR", () => {
    const quick = resolveQuickAction(
      status({
        pr: {
          number: 10,
          title: "Open PR",
          url: "https://example.com/pr/10",
          baseRef: "main",
          headRef: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, { kind: "open_pr", label: "Ver PR", disabled: false });
  });

  it("buildMenuItems disables commit/push and enables open PR", () => {
    const items = buildMenuItems(
      status({
        pr: {
          number: 11,
          title: "Existing PR",
          url: "https://example.com/pr/11",
          baseRef: "main",
          headRef: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Ver PR",
        disabled: false,
        icon: "pr",
        kind: "open_pr",
      },
    ]);
  });
});

describe("when: actions are busy", () => {
  it("resolveQuickAction returns running disabled state", () => {
    const quick = resolveQuickAction(status(), true);
    assert.deepInclude(quick, {
      kind: "show_hint",
      label: "Confirmar cambios",
      disabled: true,
      hint: "Hay una acción de Git en curso.",
    });
  });

  it("buildMenuItems disables all actions", () => {
    const items = buildMenuItems(status(), true);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: git status is unavailable", () => {
  it("resolveQuickAction returns unavailable disabled state", () => {
    const quick = resolveQuickAction(null, false);
    assert.deepInclude(quick, {
      kind: "show_hint",
      label: "Confirmar cambios",
      disabled: true,
      hint: "El estado de Git no está disponible.",
    });
  });

  it("buildMenuItems returns no menu items", () => {
    const items = buildMenuItems(null, false);
    assert.deepEqual(items, []);
  });
});

describe("when: ref is clean, ahead, and has an open PR", () => {
  it("resolveQuickAction prefers push", () => {
    const quick = resolveQuickAction(
      status({
        aheadCount: 3,
        pr: {
          number: 13,
          title: "Open PR",
          url: "https://example.com/pr/13",
          baseRef: "main",
          headRef: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, { kind: "run_action", action: "push", label: "Publicar" });
  });

  it("buildMenuItems enables push and keeps open PR available", () => {
    const items = buildMenuItems(
      status({
        aheadCount: 2,
        pr: {
          number: 12,
          title: "Existing PR",
          url: "https://example.com/pr/12",
          baseRef: "main",
          headRef: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: false,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Ver PR",
        disabled: false,
        icon: "pr",
        kind: "open_pr",
      },
    ]);
  });
});

describe("when: ref is clean, ahead, and has no open PR", () => {
  it("resolveQuickAction pushes and creates a PR", () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, pr: null }), false);
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "create_pr",
      label: "Publicar y crear PR",
    });
  });

  it("buildMenuItems enables push and create PR, with commit disabled", () => {
    const items = buildMenuItems(status({ aheadCount: 2, pr: null }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: false,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: false,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: source control provider uses merge requests", () => {
  it("uses GitLab MR terminology in quick actions and menu items", () => {
    const gitlabStatus = status({
      aheadCount: 2,
      sourceControlProvider: {
        kind: "gitlab",
        name: "GitLab",
        baseUrl: "https://gitlab.com",
      },
    });

    const quick = resolveQuickAction(gitlabStatus, false);
    const items = buildMenuItems(gitlabStatus, false);

    assert.deepInclude(quick, {
      kind: "run_action",
      action: "create_pr",
      label: "Publicar y crear MR",
    });
    assert.deepInclude(items[2], {
      id: "pr",
      label: "Crear MR",
    });
  });
});

describe("when: ref is clean, up to date, and has no open PR", () => {
  it("enables create PR when synced with upstream but ahead of default", () => {
    const syncedFeature = status({
      aheadCount: 0,
      behindCount: 0,
      aheadOfDefaultCount: 1,
      pr: null,
    });

    const quick = resolveQuickAction(syncedFeature, false);
    assert.deepInclude(quick, {
      label: "Crear PR",
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    });

    const items = buildMenuItems(syncedFeature, false);
    assert.equal(items.find((item) => item.id === "pr")?.disabled, false);
  });

  it("resolveQuickAction returns disabled no-action state", () => {
    const quick = resolveQuickAction(
      status({ aheadCount: 0, behindCount: 0, hasWorkingTreeChanges: false, pr: null }),
      false,
    );
    assert.deepInclude(quick, { kind: "show_hint", label: "Confirmar cambios", disabled: true });
  });

  it("buildMenuItems disables commit, push, and create PR", () => {
    const items = buildMenuItems(status({ aheadCount: 0, behindCount: 0, pr: null }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: ref is behind upstream", () => {
  it("resolveQuickAction returns pull", () => {
    const quick = resolveQuickAction(status({ behindCount: 2 }), false);
    assert.deepInclude(quick, { kind: "run_pull", label: "Descargar cambios", disabled: false });
  });

  it("buildMenuItems disables push and create PR", () => {
    const items = buildMenuItems(status({ behindCount: 1, pr: null }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: ref has diverged from upstream", () => {
  it("resolveQuickAction returns a disabled sync hint", () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, behindCount: 1 }), false);
    assert.deepEqual(quick, {
      label: "Sincronizar referencia",
      disabled: true,
      kind: "show_hint",
      hint: "La rama ha divergido del remoto. Reconcíliala antes de continuar.",
    });
  });
});

describe("when: working tree has local changes", () => {
  it("resolveQuickAction returns commit, push, and create PR", () => {
    const quick = resolveQuickAction(status({ hasWorkingTreeChanges: true }), false);
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push_pr",
      label: "Confirmar, publicar y crear PR",
    });
  });

  it("resolveQuickAction falls back to commit when no origin remote exists", () => {
    const quick = resolveQuickAction(
      status({ hasWorkingTreeChanges: true, hasUpstream: false }),
      false,
      false,
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit",
      label: "Confirmar cambios",
      disabled: false,
    });
  });

  it("resolveQuickAction returns commit and push when open PR exists", () => {
    const quick = resolveQuickAction(
      status({
        hasWorkingTreeChanges: true,
        pr: {
          number: 16,
          title: "Existing PR",
          url: "https://example.com/pr/16",
          baseRef: "main",
          headRef: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      label: "Confirmar y publicar",
    });
  });

  it("buildMenuItems enables commit and disables push and PR", () => {
    const items = buildMenuItems(status({ hasWorkingTreeChanges: true }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: false,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });

  it("buildMenuItems enables push for ahead commits while local changes remain uncommitted", () => {
    const items = buildMenuItems(
      status({
        refName: "feature/test",
        hasWorkingTreeChanges: true,
        aheadCount: 1,
        workingTree: {
          files: [{ path: ".vercel/project.json", insertions: 1, deletions: 0 }],
          insertions: 1,
          deletions: 0,
        },
      }),
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: false,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: false,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: on default ref without open PR", () => {
  it("resolveQuickAction returns commit and push when local changes exist", () => {
    const quick = resolveQuickAction(
      status({ refName: "main", hasWorkingTreeChanges: true }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      label: "Confirmar y publicar",
      disabled: false,
    });
  });

  it("resolveQuickAction returns push when ref is ahead", () => {
    const quick = resolveQuickAction(
      status({ refName: "main", aheadCount: 2, pr: null }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      label: "Publicar",
      disabled: false,
    });
  });
});

describe("when: working tree has local changes and ref is behind upstream", () => {
  it("resolveQuickAction still prefers commit, push, and create PR", () => {
    const quick = resolveQuickAction(
      status({ hasWorkingTreeChanges: true, behindCount: 1 }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push_pr",
      label: "Confirmar, publicar y crear PR",
    });
  });

  it("buildMenuItems enables commit and keeps push and PR disabled", () => {
    const items = buildMenuItems(status({ hasWorkingTreeChanges: true, behindCount: 2 }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: false,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: HEAD is detached and there are no local changes", () => {
  it("resolveQuickAction shows detached head hint", () => {
    const quick = resolveQuickAction(
      status({ refName: null, hasWorkingTreeChanges: false, hasUpstream: false }),
      false,
    );
    assert.deepInclude(quick, { kind: "show_hint", label: "Confirmar cambios", disabled: true });
  });

  it("buildMenuItems keeps commit, push, and PR disabled", () => {
    const items = buildMenuItems(status({ refName: null, hasWorkingTreeChanges: false }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: ref has no upstream configured", () => {
  it("resolveQuickAction is disabled when clean, no upstream, and no local commits are ahead", () => {
    const quick = resolveQuickAction(
      status({ hasUpstream: false, pr: null, aheadCount: 0 }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "show_hint",
      label: "Publicar",
      hint: "No hay commits locales que enviar.",
      disabled: true,
    });
  });

  it("resolveQuickAction opens PR when clean, no upstream, no local commits are ahead, and PR exists", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 0,
        pr: {
          number: 14,
          title: "Existing PR",
          url: "https://example.com/pr/14",
          baseRef: "main",
          headRef: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "open_pr",
      label: "Ver PR",
      disabled: false,
    });
  });

  it("resolveQuickAction runs push when clean, no upstream, and local commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 1,
        pr: {
          number: 15,
          title: "Existing PR",
          url: "https://example.com/pr/15",
          baseRef: "main",
          headRef: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "push",
      label: "Publicar",
      disabled: false,
    });
  });

  it("buildMenuItems disables push and create PR when no commits are ahead", () => {
    const items = buildMenuItems(status({ hasUpstream: false, pr: null, aheadCount: 0 }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });

  it("resolveQuickAction runs push and create PR when no upstream and commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 2,
        pr: null,
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "create_pr",
      label: "Publicar y crear PR",
      disabled: false,
    });
  });

  it("resolveQuickAction publishes when no origin remote exists", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 2,
        pr: null,
      }),
      false,
      false,
      false,
    );
    assert.deepEqual(quick, {
      kind: "open_publish",
      label: "Publicar repositorio",
      disabled: false,
    });
  });

  it("buildMenuItems enables create PR when no upstream and commits are ahead", () => {
    const items = buildMenuItems(status({ hasUpstream: false, pr: null, aheadCount: 2 }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: false,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: false,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });

  it("buildMenuItems hides push and create PR when no origin remote exists", () => {
    const items = buildMenuItems(
      status({ hasUpstream: false, pr: null, aheadCount: 2 }),
      false,
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
    ]);
  });

  it("resolveQuickAction is disabled on default ref when no upstream exists and no commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        refName: "main",
        hasUpstream: false,
        aheadCount: 0,
        pr: null,
      }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "show_hint",
      label: "Publicar",
      hint: "No hay commits locales que enviar.",
      disabled: true,
    });
  });

  it("resolveQuickAction uses push-only on default ref when no upstream exists and commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        refName: "main",
        hasUpstream: false,
        aheadCount: 1,
        pr: null,
      }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      label: "Publicar",
      disabled: false,
    });
  });

  it("buildMenuItems still disables push and create PR when ref is behind", () => {
    const items = buildMenuItems(
      status({
        hasUpstream: false,
        behindCount: 1,
        aheadCount: 0,
        pr: null,
      }),
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "Confirmar cambios",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "Publicar",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "Crear PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("requiresDefaultBranchConfirmation", () => {
  it("requires confirmation for push actions on default ref", () => {
    assert.isFalse(requiresDefaultBranchConfirmation("commit", true));
    assert.isTrue(requiresDefaultBranchConfirmation("push", true));
    assert.isTrue(requiresDefaultBranchConfirmation("create_pr", true));
    assert.isTrue(requiresDefaultBranchConfirmation("commit_push", true));
    assert.isTrue(requiresDefaultBranchConfirmation("commit_push_pr", true));
    assert.isFalse(requiresDefaultBranchConfirmation("commit_push", false));
    assert.isFalse(requiresDefaultBranchConfirmation("push", false));
  });
});

describe("resolveDefaultBranchActionDialogCopy", () => {
  it("uses push-only copy when pushing without a commit", () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: "commit_push",
      branchName: "main",
      includesCommit: false,
    });

    assert.deepEqual(copy, {
      title: "¿Publicar en la referencia predeterminada?",
      description:
        "Esta acción publicará los commits locales en «main». Puedes continuar en esta referencia o crear una referencia de trabajo y ejecutar allí la misma acción.",
      continueLabel: "Publicar en main",
    });
  });

  it("uses push-and-pr copy when creating a PR without a commit", () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: "commit_push_pr",
      branchName: "main",
      includesCommit: false,
    });

    assert.deepEqual(copy, {
      title: "¿Publicar y crear PR desde la referencia predeterminada?",
      description:
        "Esta acción publicará los commits locales y creará pull request en «main». Puedes continuar en esta referencia o crear una referencia de trabajo y ejecutar allí la misma acción.",
      continueLabel: "Publicar y crear PR",
    });
  });

  it("keeps commit copy when the action includes a commit", () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: "commit_push_pr",
      branchName: "main",
      includesCommit: true,
    });

    assert.deepEqual(copy, {
      title: "¿Confirmar, publicar y crear PR desde la referencia predeterminada?",
      description:
        "Esta acción confirmará los cambios, los publicará y creará pull request en «main». Puedes continuar en esta referencia o crear una referencia de trabajo y ejecutar allí la misma acción.",
      continueLabel: "Confirmar, publicar y crear PR",
    });
  });
});

describe("buildGitActionProgressStages", () => {
  it("shows only push progress for explicit push actions", () => {
    const stages = buildGitActionProgressStages({
      action: "push",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      pushTarget: "origin/feature/test",
    });
    assert.deepEqual(stages, ["Publicando en origin/feature/test..."]);
  });

  it("shows push and PR progress for create-pr actions that still need a push", () => {
    const stages = buildGitActionProgressStages({
      action: "create_pr",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      pushTarget: "origin/feature/test",
      shouldPushBeforePr: true,
    });
    assert.deepEqual(stages, [
      "Publicando en origin/feature/test...",
      "Preparando PR...",
      "Generando el contenido de PR...",
      "Creando pull request...",
    ]);
  });

  it("shows only PR progress when create-pr can skip the push", () => {
    const stages = buildGitActionProgressStages({
      action: "create_pr",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      shouldPushBeforePr: false,
    });
    assert.deepEqual(stages, [
      "Preparando PR...",
      "Generando el contenido de PR...",
      "Creando pull request...",
    ]);
  });

  it("includes commit stages for commit+push when working tree is dirty", () => {
    const stages = buildGitActionProgressStages({
      action: "commit_push",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      pushTarget: "origin/feature/test",
    });
    assert.deepEqual(stages, [
      "Generando el mensaje del commit...",
      "Confirmando cambios...",
      "Publicando en origin/feature/test...",
    ]);
  });

  it("includes granular PR stages for commit+push+PR actions", () => {
    const stages = buildGitActionProgressStages({
      action: "commit_push_pr",
      hasCustomCommitMessage: true,
      hasWorkingTreeChanges: true,
      pushTarget: "origin/feature/test",
    });
    assert.deepEqual(stages, [
      "Confirmando cambios...",
      "Publicando en origin/feature/test...",
      "Preparando PR...",
      "Generando el contenido de PR...",
      "Creando pull request...",
    ]);
  });
});

describe("resolveThreadBranchUpdate", () => {
  it("returns a branch update when the action created a new branch", () => {
    const update = resolveThreadBranchUpdate({
      action: "commit_push_pr",
      branch: {
        status: "created",
        name: "feature/fix-toast-copy",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: add ref sync",
      },
      push: { status: "pushed", branch: "feature/fix-toast-copy" },
      pr: { status: "skipped_not_requested" },
      toast: {
        title: "Pushed 89abcde to origin/feature/fix-toast-copy",
        cta: { kind: "none" },
      },
    });

    assert.deepEqual(update, {
      branch: "feature/fix-toast-copy",
    });
  });

  it("returns null when the action stayed on the existing branch", () => {
    const update = resolveThreadBranchUpdate({
      action: "commit_push",
      branch: {
        status: "skipped_not_requested",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: add ref sync",
      },
      push: { status: "pushed", branch: "feature/fix-toast-copy" },
      pr: { status: "skipped_not_requested" },
      toast: {
        title: "Pushed 89abcde to origin/feature/fix-toast-copy",
        cta: { kind: "none" },
      },
    });

    assert.equal(update, null);
  });
});

describe("resolveLiveThreadBranchUpdate", () => {
  it("returns a branch update when live git status differs from stored thread metadata", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "feature/old-ref",
      gitStatus: status({ refName: "effect-atom" }),
    });

    assert.deepEqual(update, {
      branch: "effect-atom",
    });
  });

  it("returns null when live git status is unavailable", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "feature/old-ref",
      gitStatus: null,
    });

    assert.equal(update, null);
  });

  it("returns null when the stored thread ref already matches git status", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "effect-atom",
      gitStatus: status({ refName: "effect-atom" }),
    });

    assert.equal(update, null);
  });

  it("returns null when git status is detached HEAD but the thread already has a ref", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "effect-atom",
      gitStatus: status({ refName: null }),
    });

    assert.equal(update, null);
  });

  it("does not regress a semantic thread ref back to a temporary worktree ref", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "t3code/github-query-rate-limit",
      gitStatus: status({ refName: "t3code/bda76797" }),
    });

    assert.equal(update, null);
  });

  it("allows a temporary worktree ref to reconcile to a semantic branch", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "t3code/a9628676",
      gitStatus: status({ refName: "feature/diff-panel-toggle" }),
    });

    assert.deepEqual(update, { branch: "feature/diff-panel-toggle" });
  });
});

describe("resolveThreadBranchMetadataPatch", () => {
  it("does not overwrite worktree metadata while reconciling a branch", () => {
    assert.deepEqual(
      resolveThreadBranchMetadataPatch("feature/current-ref", "feature/previous-ref"),
      {
        branch: "feature/current-ref",
        expectedBranch: "feature/previous-ref",
      },
    );
  });
});

describe("resolveAutoFeatureBranchName", () => {
  it("uses semantic preferred ref names when available", () => {
    const ref = resolveAutoFeatureBranchName(["main", "feature/other"], "fix toast copy");
    assert.equal(ref, "feature/fix-toast-copy");
  });

  it("normalizes preferred names that already include a ref namespace", () => {
    const ref = resolveAutoFeatureBranchName(["main"], "feature/refine-toolbar-actions");
    assert.equal(ref, "feature/refine-toolbar-actions");
  });

  it("increments suffix when the preferred ref name already exists", () => {
    const ref = resolveAutoFeatureBranchName(
      ["main", "feature/fix-toast-copy", "feature/fix-toast-copy-2"],
      "fix toast copy",
    );
    assert.equal(ref, "feature/fix-toast-copy-3");
  });

  it("treats existing ref names as case-insensitive for collision checks", () => {
    const ref = resolveAutoFeatureBranchName(["Feature/Ticket-1"], "feature/ticket-1");
    assert.equal(ref, "feature/ticket-1-2");
  });

  it("falls back to feature/update when no preferred name is provided", () => {
    const ref = resolveAutoFeatureBranchName(["main"]);
    assert.equal(ref, "feature/update");
  });
});
