import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CheckpointRef, MessageId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { FenixCodeTenantScope } from "../../fenix/FenixCodeTenantScope.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { FenixScopedProjectionSnapshotQuery } from "../Services/FenixScopedProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { FenixScopedProjectionSnapshotQueryLive } from "./FenixScopedProjectionSnapshotQuery.ts";

const scopeA = { companyId: 5, userId: 10 } satisfies FenixCodeTenantScope;
const scopeB = { companyId: 6, userId: 11 } satisfies FenixCodeTenantScope;
const sameCompanyOtherUserScope = { companyId: 5, userId: 11 } satisfies FenixCodeTenantScope;
const otherCompanySameUserScope = { companyId: 6, userId: 10 } satisfies FenixCodeTenantScope;
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

const scopedLayer = it.layer(
  Layer.mergeAll(
    OrchestrationProjectionSnapshotQueryLive,
    FenixScopedProjectionSnapshotQueryLive.pipe(
      Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    ),
  ).pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

const seedScopedTenant = (
  sql: SqlClient.SqlClient,
  input: {
    readonly scope: FenixCodeTenantScope;
    readonly projectId: string;
    readonly threadId: string;
    readonly title: string;
    readonly workspaceRoot: string;
  },
) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO projection_projects (
        project_id,
        title,
        workspace_root,
        default_model_selection_json,
        scripts_json,
        created_at,
        updated_at,
        deleted_at,
        fenix_company_id,
        fenix_user_id
      )
      VALUES (
        ${input.projectId},
        ${input.title},
        ${input.workspaceRoot},
        '{"provider":"codex","model":"gpt-5-codex"}',
        '[]',
        '2026-08-09T00:00:00.000Z',
        '2026-08-09T00:00:01.000Z',
        NULL,
        ${input.scope.companyId},
        ${input.scope.userId}
      )
    `;

    yield* sql`
      INSERT INTO projection_threads (
        thread_id,
        project_id,
        title,
        model_selection_json,
        runtime_mode,
        interaction_mode,
        branch,
        worktree_path,
        latest_turn_id,
        latest_user_message_at,
        pending_approval_count,
        pending_user_input_count,
        has_actionable_proposed_plan,
        created_at,
        updated_at,
        archived_at,
        deleted_at
      )
      VALUES (
        ${input.threadId},
        ${input.projectId},
        ${input.title},
        '{"provider":"codex","model":"gpt-5-codex"}',
        'full-access',
        'default',
        NULL,
        ${`${input.workspaceRoot}/worktree`},
        'turn-1',
        '2026-08-09T00:00:02.000Z',
        0,
        0,
        0,
        '2026-08-09T00:00:02.000Z',
        '2026-08-09T00:00:03.000Z',
        NULL,
        NULL
      )
    `;

    yield* sql`
      INSERT INTO projection_thread_messages (
        message_id,
        thread_id,
        turn_id,
        role,
        text,
        is_streaming,
        created_at,
        updated_at
      )
      VALUES (
        ${`${input.threadId}-message`},
        ${input.threadId},
        'turn-1',
        'user',
        ${`shared needle from ${input.title}`},
        0,
        '2026-08-09T00:00:04.000Z',
        '2026-08-09T00:00:04.000Z'
      )
    `;

    yield* sql`
      INSERT INTO projection_thread_sessions (
        thread_id,
        status,
        provider_name,
        provider_session_id,
        provider_thread_id,
        runtime_mode,
        active_turn_id,
        last_error,
        updated_at
      )
      VALUES (
        ${input.threadId},
        'running',
        'fenix',
        ${`${input.threadId}-provider-session`},
        ${`${input.threadId}-provider-thread`},
        'full-access',
        'turn-1',
        NULL,
        '2026-08-09T00:00:05.000Z'
      )
    `;

    yield* sql`
      INSERT INTO projection_turns (
        thread_id,
        turn_id,
        pending_message_id,
        source_proposed_plan_thread_id,
        source_proposed_plan_id,
        assistant_message_id,
        state,
        requested_at,
        started_at,
        completed_at,
        checkpoint_turn_count,
        checkpoint_ref,
        checkpoint_status,
        checkpoint_files_json
      )
      VALUES (
        ${input.threadId},
        'turn-1',
        ${`${input.threadId}-message`},
        NULL,
        NULL,
        NULL,
        'completed',
        '2026-08-09T00:00:06.000Z',
        '2026-08-09T00:00:06.000Z',
        '2026-08-09T00:00:07.000Z',
        1,
        ${`${input.threadId}-checkpoint`},
        'ready',
        '[{"path":"README.md","kind":"modified","additions":1,"deletions":0}]'
      )
    `;
  });

scopedLayer("FenixScopedProjectionSnapshotQuery", (it) => {
  it.effect("isolates projects, threads, sessions, checkpoints, and search by pairing tenant", () =>
    Effect.gen(function* () {
      const scopedQuery = yield* FenixScopedProjectionSnapshotQuery;
      const baseQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;

      yield* seedScopedTenant(sql, {
        scope: sameCompanyOtherUserScope,
        projectId: "project-0-cross-user",
        threadId: "thread-cross-user",
        title: "Tenant Same Company Other User",
        workspaceRoot: "/tmp/fenix-cross-user",
      });
      yield* seedScopedTenant(sql, {
        scope: scopeA,
        projectId: "project-a",
        threadId: "thread-a",
        title: "Tenant A",
        workspaceRoot: "/tmp/fenix-a",
      });
      yield* seedScopedTenant(sql, {
        scope: scopeB,
        projectId: "project-b",
        threadId: "thread-b",
        title: "Tenant B",
        workspaceRoot: "/tmp/fenix-b",
      });
      yield* seedScopedTenant(sql, {
        scope: otherCompanySameUserScope,
        projectId: "project-cross-company",
        threadId: "thread-cross-company",
        title: "Tenant Other Company Same User",
        workspaceRoot: "/tmp/fenix-c",
      });
      yield* sql`
        UPDATE projection_projects
        SET updated_at = '2026-08-09T02:00:00.000Z'
        WHERE project_id = 'project-b'
      `;
      yield* sql`
        UPDATE projection_threads
        SET updated_at = '2026-08-09T02:00:01.000Z'
        WHERE thread_id = 'thread-b'
      `;

      const unscopedSnapshot = yield* baseQuery.getShellSnapshot();
      assert.deepEqual(
        unscopedSnapshot.threads.map((thread) => thread.id).sort(),
        [
          asThreadId("thread-a"),
          asThreadId("thread-b"),
          asThreadId("thread-cross-company"),
          asThreadId("thread-cross-user"),
        ].sort(),
      );
      assert.equal(unscopedSnapshot.updatedAt, "2026-08-09T02:00:01.000Z");

      const scopedSnapshot = yield* scopedQuery.getShellSnapshot(scopeA);
      assert.deepEqual(
        scopedSnapshot.projects.map((project) => project.id),
        [asProjectId("project-a")],
      );
      assert.deepEqual(
        scopedSnapshot.threads.map((thread) => thread.id),
        [asThreadId("thread-a")],
      );
      assert.equal(scopedSnapshot.threads[0]?.session?.providerName, "fenix");
      assert.equal(scopedSnapshot.updatedAt, "2026-08-09T00:00:07.000Z");

      const scopedReadModel = yield* scopedQuery.getSnapshot(scopeA);
      assert.deepEqual(
        scopedReadModel.threads.map((thread) => thread.id),
        [asThreadId("thread-a")],
      );
      assert.equal(scopedReadModel.updatedAt, "2026-08-09T00:00:07.000Z");

      const counts = yield* scopedQuery.getCounts(scopeA);
      assert.deepEqual(counts, { projectCount: 1, threadCount: 1 });

      const ownWorkspace = yield* scopedQuery.getActiveProjectByWorkspaceRoot(
        scopeA,
        "/tmp/fenix-a",
      );
      assert.equal(ownWorkspace._tag, "Some");
      if (ownWorkspace._tag === "Some") {
        assert.equal(ownWorkspace.value.id, asProjectId("project-a"));
      }
      const foreignWorkspace = yield* scopedQuery.getActiveProjectByWorkspaceRoot(
        scopeA,
        "/tmp/fenix-b",
      );
      assert.equal(foreignWorkspace._tag, "None");
      const sameCompanyOtherUserWorkspace = yield* scopedQuery.getActiveProjectByWorkspaceRoot(
        scopeA,
        "/tmp/fenix-cross-user",
      );
      assert.equal(sameCompanyOtherUserWorkspace._tag, "None");
      const otherCompanySameUserWorkspace = yield* scopedQuery.getActiveProjectByWorkspaceRoot(
        scopeA,
        "/tmp/fenix-c",
      );
      assert.equal(otherCompanySameUserWorkspace._tag, "None");

      const otherCompanyProject = yield* scopedQuery.getProjectShellById(
        scopeA,
        asProjectId("project-b"),
      );
      assert.equal(otherCompanyProject._tag, "None");
      const sameCompanyOtherUserProject = yield* scopedQuery.getProjectShellById(
        scopeA,
        asProjectId("project-0-cross-user"),
      );
      assert.equal(sameCompanyOtherUserProject._tag, "None");
      const otherCompanySameUserProject = yield* scopedQuery.getProjectShellById(
        scopeA,
        asProjectId("project-cross-company"),
      );
      assert.equal(otherCompanySameUserProject._tag, "None");
      const ownFirstThread = yield* scopedQuery.getFirstActiveThreadIdByProjectId(
        scopeA,
        asProjectId("project-a"),
      );
      assert.equal(ownFirstThread._tag, "Some");
      if (ownFirstThread._tag === "Some") {
        assert.equal(ownFirstThread.value, asThreadId("thread-a"));
      }
      const foreignFirstThread = yield* scopedQuery.getFirstActiveThreadIdByProjectId(
        scopeA,
        asProjectId("project-b"),
      );
      assert.equal(foreignFirstThread._tag, "None");
      const sameCompanyOtherUserFirstThread = yield* scopedQuery.getFirstActiveThreadIdByProjectId(
        scopeA,
        asProjectId("project-0-cross-user"),
      );
      assert.equal(sameCompanyOtherUserFirstThread._tag, "None");
      const otherCompanySameUserFirstThread = yield* scopedQuery.getFirstActiveThreadIdByProjectId(
        scopeA,
        asProjectId("project-cross-company"),
      );
      assert.equal(otherCompanySameUserFirstThread._tag, "None");

      const ownThreadShell = yield* scopedQuery.getThreadShellById(scopeA, asThreadId("thread-a"));
      assert.equal(ownThreadShell._tag, "Some");
      if (ownThreadShell._tag === "Some") {
        assert.equal(ownThreadShell.value.session?.threadId, asThreadId("thread-a"));
      }
      const foreignThreadShell = yield* scopedQuery.getThreadShellById(
        scopeA,
        asThreadId("thread-b"),
      );
      assert.equal(foreignThreadShell._tag, "None");
      const sameCompanyOtherUserThreadShell = yield* scopedQuery.getThreadShellById(
        scopeA,
        asThreadId("thread-cross-user"),
      );
      assert.equal(sameCompanyOtherUserThreadShell._tag, "None");

      const ownThread = yield* scopedQuery.getThreadDetailById(scopeA, asThreadId("thread-a"));
      assert.equal(ownThread._tag, "Some");
      if (ownThread._tag === "Some") {
        assert.deepEqual(
          ownThread.value.messages.map((message) => message.id),
          [MessageId.make("thread-a-message")],
        );
        assert.deepEqual(
          ownThread.value.checkpoints.map((checkpoint) => checkpoint.checkpointRef),
          [CheckpointRef.make("thread-a-checkpoint")],
        );
        assert.equal(ownThread.value.session?.threadId, asThreadId("thread-a"));
      }

      const foreignThread = yield* scopedQuery.getThreadDetailById(scopeA, asThreadId("thread-b"));
      assert.equal(foreignThread._tag, "None");
      const sameCompanyOtherUserThread = yield* scopedQuery.getThreadDetailById(
        scopeA,
        asThreadId("thread-cross-user"),
      );
      assert.equal(sameCompanyOtherUserThread._tag, "None");
      const otherCompanySameUserThread = yield* scopedQuery.getThreadDetailById(
        scopeA,
        asThreadId("thread-cross-company"),
      );
      assert.equal(otherCompanySameUserThread._tag, "None");
      const ownThreadDetailSnapshot = yield* scopedQuery.getThreadDetailSnapshot(
        scopeA,
        asThreadId("thread-a"),
      );
      assert.equal(ownThreadDetailSnapshot._tag, "Some");
      if (ownThreadDetailSnapshot._tag === "Some") {
        assert.equal(ownThreadDetailSnapshot.value.thread.id, asThreadId("thread-a"));
      }
      const foreignThreadDetailSnapshot = yield* scopedQuery.getThreadDetailSnapshot(
        scopeA,
        asThreadId("thread-b"),
      );
      assert.equal(foreignThreadDetailSnapshot._tag, "None");
      const sameCompanyOtherUserThreadDetailSnapshot = yield* scopedQuery.getThreadDetailSnapshot(
        scopeA,
        asThreadId("thread-cross-user"),
      );
      assert.equal(sameCompanyOtherUserThreadDetailSnapshot._tag, "None");

      const foreignCheckpointContext = yield* scopedQuery.getThreadCheckpointContext(
        scopeA,
        asThreadId("thread-b"),
      );
      assert.equal(foreignCheckpointContext._tag, "None");
      const sameCompanyOtherUserCheckpointContext = yield* scopedQuery.getThreadCheckpointContext(
        scopeA,
        asThreadId("thread-cross-user"),
      );
      assert.equal(sameCompanyOtherUserCheckpointContext._tag, "None");
      const otherCompanySameUserCheckpointContext = yield* scopedQuery.getThreadCheckpointContext(
        scopeA,
        asThreadId("thread-cross-company"),
      );
      assert.equal(otherCompanySameUserCheckpointContext._tag, "None");

      const ownCheckpointContext = yield* scopedQuery.getThreadCheckpointContext(
        scopeA,
        asThreadId("thread-a"),
      );
      assert.equal(ownCheckpointContext._tag, "Some");
      if (ownCheckpointContext._tag === "Some") {
        assert.deepEqual(
          ownCheckpointContext.value.checkpoints.map((checkpoint) => checkpoint.turnId),
          [TurnId.make("turn-1")],
        );
        assert.equal(ownCheckpointContext.value.workspaceRoot, "/tmp/fenix-a");
      }
      const ownFullDiffContext = yield* scopedQuery.getFullThreadDiffContext(
        scopeA,
        asThreadId("thread-a"),
        1,
      );
      assert.equal(ownFullDiffContext._tag, "Some");
      if (ownFullDiffContext._tag === "Some") {
        assert.equal(ownFullDiffContext.value.threadId, asThreadId("thread-a"));
        assert.equal(
          ownFullDiffContext.value.toCheckpointRef,
          CheckpointRef.make("thread-a-checkpoint"),
        );
      }
      const foreignFullDiffContext = yield* scopedQuery.getFullThreadDiffContext(
        scopeA,
        asThreadId("thread-b"),
        1,
      );
      assert.equal(foreignFullDiffContext._tag, "None");
      const sameCompanyOtherUserFullDiffContext = yield* scopedQuery.getFullThreadDiffContext(
        scopeA,
        asThreadId("thread-cross-user"),
        1,
      );
      assert.equal(sameCompanyOtherUserFullDiffContext._tag, "None");

      const search = yield* scopedQuery.searchThreads(scopeA, { query: "shared needle" });
      assert.deepEqual(
        search.matches.map((match) => match.threadId),
        [asThreadId("thread-a")],
      );

      const limitedSearch = yield* scopedQuery.searchThreads(scopeA, {
        query: "shared needle",
        limit: 1,
      });
      assert.deepEqual(
        limitedSearch.matches.map((match) => match.threadId),
        [asThreadId("thread-a")],
      );
    }),
  );

  it.effect("fails closed when the pairing scope is absent or malformed", () =>
    Effect.gen(function* () {
      const scopedQuery = yield* FenixScopedProjectionSnapshotQuery;
      const baseQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const malformedScope = { companyId: Number.NaN, userId: 1 } as FenixCodeTenantScope;
      const absentScope = undefined as unknown as FenixCodeTenantScope;
      const emptyValidScope = { companyId: 99, userId: 99 } satisfies FenixCodeTenantScope;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_sessions`;
      yield* sql`DELETE FROM projection_turns`;
      yield* seedScopedTenant(sql, {
        scope: scopeA,
        projectId: "project-a",
        threadId: "thread-a",
        title: "Tenant A",
        workspaceRoot: "/tmp/fenix-a",
      });
      const baseSnapshot = yield* baseQuery.getShellSnapshot();

      const snapshot = yield* scopedQuery.getShellSnapshot(malformedScope);
      assert.deepEqual(snapshot.projects, []);
      assert.deepEqual(snapshot.threads, []);
      assert.equal(snapshot.snapshotSequence, baseSnapshot.snapshotSequence);
      const absentSnapshot = yield* scopedQuery.getShellSnapshot(absentScope);
      assert.deepEqual(absentSnapshot.projects, []);
      assert.deepEqual(absentSnapshot.threads, []);
      assert.equal(absentSnapshot.snapshotSequence, baseSnapshot.snapshotSequence);
      const emptyValidSnapshot = yield* scopedQuery.getShellSnapshot(emptyValidScope);
      assert.deepEqual(emptyValidSnapshot.projects, []);
      assert.deepEqual(emptyValidSnapshot.threads, []);
      assert.equal(emptyValidSnapshot.snapshotSequence, baseSnapshot.snapshotSequence);

      const counts = yield* scopedQuery.getCounts(malformedScope);
      assert.deepEqual(counts, { projectCount: 0, threadCount: 0 });
      const absentCounts = yield* scopedQuery.getCounts(absentScope);
      assert.deepEqual(absentCounts, { projectCount: 0, threadCount: 0 });

      const thread = yield* scopedQuery.getThreadDetailById(malformedScope, asThreadId("thread-a"));
      assert.equal(thread._tag, "None");
      const absentThread = yield* scopedQuery.getThreadDetailById(
        absentScope,
        asThreadId("thread-a"),
      );
      assert.equal(absentThread._tag, "None");
    }),
  );
});
