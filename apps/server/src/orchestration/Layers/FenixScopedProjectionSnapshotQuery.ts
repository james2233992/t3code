import {
  ProjectId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationProjectShell,
  type OrchestrationReadModel,
  type OrchestrationSearchThreadsResult,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isValidFenixCodeTenantScope,
  type FenixCodeTenantScope,
} from "../../fenix/FenixCodeTenantScope.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotCounts,
} from "../Services/ProjectionSnapshotQuery.ts";
import {
  FenixScopedProjectionSnapshotQuery,
  type FenixScopedProjectionSnapshotQueryShape,
} from "../Services/FenixScopedProjectionSnapshotQuery.ts";

const ScopeInput = Schema.Struct({
  companyId: Schema.Number,
  userId: Schema.Number,
});
const ScopedProjectIdRow = Schema.Struct({
  projectId: Schema.String,
});
const ThreadScopeInput = Schema.Struct({
  companyId: Schema.Number,
  userId: Schema.Number,
  threadId: Schema.String,
});
const ProjectScopeInput = Schema.Struct({
  companyId: Schema.Number,
  userId: Schema.Number,
  projectId: Schema.String,
});
const WorkspaceScopeInput = Schema.Struct({
  companyId: Schema.Number,
  userId: Schema.Number,
  workspaceRoot: Schema.String,
});
const ScopedCountsRow = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});
const ScopedSearchInput = Schema.Struct({
  companyId: Schema.Number,
  userId: Schema.Number,
  pattern: Schema.String,
  limit: Schema.Number,
});
const ScopedSearchRow = Schema.Struct({
  threadId: Schema.String,
  projectId: Schema.String,
  source: Schema.Literals(["user", "assistant"]),
  matchText: Schema.String,
  messageCreatedAt: Schema.String,
});
const EMPTY_UPDATED_AT = "1970-01-01T00:00:00.000Z";

function emptyReadModel(snapshotSequence = 0): OrchestrationReadModel {
  return {
    snapshotSequence,
    projects: [],
    threads: [],
    updatedAt: EMPTY_UPDATED_AT,
  };
}

function emptyShellSnapshot(snapshotSequence = 0): OrchestrationShellSnapshot {
  return {
    snapshotSequence,
    projects: [],
    threads: [],
    updatedAt: EMPTY_UPDATED_AT,
  };
}

function projectIdSet(rows: ReadonlyArray<{ readonly projectId: string }>): ReadonlySet<string> {
  return new Set(rows.map((row) => row.projectId));
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
}

function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function buildSearchSnippet(text: string, query: string): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length <= 240) {
    return normalizedText;
  }

  const normalizedQuery = foldAsciiCase(query.replace(/\s+/g, " ").trim());
  const matchIndex = foldAsciiCase(normalizedText).indexOf(normalizedQuery);
  const bodyLength = 236;
  const idealStart = Math.max(0, matchIndex - 72);
  const start = Math.min(idealStart, normalizedText.length - bodyLength);
  const end = Math.min(normalizedText.length, start + bodyLength);
  return `${start > 0 ? "…" : ""}${normalizedText.slice(start, end)}${
    end < normalizedText.length ? "…" : ""
  }`;
}

function latestIsoDate(values: ReadonlyArray<string | null | undefined>): string {
  let latest: string | undefined;
  for (const value of values) {
    if (value == null) {
      continue;
    }
    if (latest == null || value > latest) {
      latest = value;
    }
  }
  return latest ?? EMPTY_UPDATED_AT;
}

function readModelUpdatedAt(
  projects: ReadonlyArray<OrchestrationProject>,
  threads: ReadonlyArray<OrchestrationThread>,
): string {
  const values: Array<string | null | undefined> = [];
  for (const project of projects) {
    values.push(project.createdAt, project.updatedAt, project.deletedAt);
  }
  for (const thread of threads) {
    values.push(
      thread.createdAt,
      thread.updatedAt,
      thread.archivedAt,
      thread.deletedAt,
      thread.settledAt,
      thread.snoozedUntil,
      thread.snoozedAt,
      thread.pinnedAt,
      thread.latestTurn?.requestedAt,
      thread.latestTurn?.startedAt,
      thread.latestTurn?.completedAt,
      thread.session?.updatedAt,
    );
    for (const message of thread.messages) {
      values.push(message.createdAt, message.updatedAt);
    }
    for (const proposedPlan of thread.proposedPlans) {
      values.push(proposedPlan.createdAt, proposedPlan.updatedAt, proposedPlan.implementedAt);
    }
    for (const activity of thread.activities) {
      values.push(activity.createdAt);
    }
    for (const checkpoint of thread.checkpoints) {
      values.push(checkpoint.completedAt);
    }
  }
  return latestIsoDate(values);
}

function shellSnapshotUpdatedAt(
  projects: ReadonlyArray<OrchestrationProjectShell>,
  threads: ReadonlyArray<OrchestrationThreadShell>,
): string {
  const values: Array<string | null | undefined> = [];
  for (const project of projects) {
    values.push(project.createdAt, project.updatedAt);
  }
  for (const thread of threads) {
    values.push(
      thread.createdAt,
      thread.updatedAt,
      thread.archivedAt,
      thread.settledAt,
      thread.snoozedUntil,
      thread.snoozedAt,
      thread.pinnedAt,
      thread.latestUserMessageAt,
      thread.latestTurn?.requestedAt,
      thread.latestTurn?.startedAt,
      thread.latestTurn?.completedAt,
      thread.session?.updatedAt,
    );
  }
  return latestIsoDate(values);
}

function filterReadModelByProjects(
  readModel: OrchestrationReadModel,
  visibleProjectIds: ReadonlySet<string>,
): OrchestrationReadModel {
  const projects = readModel.projects.filter((project) => visibleProjectIds.has(project.id));
  const threads = readModel.threads.filter((thread) => visibleProjectIds.has(thread.projectId));
  return {
    ...readModel,
    projects,
    threads,
    updatedAt: readModelUpdatedAt(projects, threads),
  };
}

function filterShellByProjects(
  snapshot: OrchestrationShellSnapshot,
  visibleProjectIds: ReadonlySet<string>,
): OrchestrationShellSnapshot {
  const projects = snapshot.projects.filter((project) => visibleProjectIds.has(project.id));
  const threads = snapshot.threads.filter((thread) => visibleProjectIds.has(thread.projectId));
  return {
    ...snapshot,
    projects,
    threads,
    updatedAt: shellSnapshotUpdatedAt(projects, threads),
  };
}

const makeFenixScopedProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const baseQuery = yield* ProjectionSnapshotQuery;

  const listScopedProjectRows = SqlSchema.findAll({
    Request: ScopeInput,
    Result: ScopedProjectIdRow,
    execute: ({ companyId, userId }) =>
      sql`
        SELECT project_id AS "projectId"
        FROM projection_projects
        WHERE fenix_company_id = ${companyId}
          AND fenix_user_id = ${userId}
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const readScopedCounts = SqlSchema.findOne({
    Request: ScopeInput,
    Result: ScopedCountsRow,
    execute: ({ companyId, userId }) =>
      sql`
        SELECT
          (
            SELECT COUNT(*)
            FROM projection_projects
            WHERE fenix_company_id = ${companyId}
              AND fenix_user_id = ${userId}
          ) AS "projectCount",
          (
            SELECT COUNT(*)
            FROM projection_threads AS threads
            INNER JOIN projection_projects AS projects
              ON projects.project_id = threads.project_id
            WHERE projects.fenix_company_id = ${companyId}
              AND projects.fenix_user_id = ${userId}
          ) AS "threadCount"
      `,
  });

  const readScopedProject = SqlSchema.findOneOption({
    Request: ProjectScopeInput,
    Result: ScopedProjectIdRow,
    execute: ({ companyId, userId, projectId }) =>
      sql`
        SELECT project_id AS "projectId"
        FROM projection_projects
        WHERE project_id = ${projectId}
          AND fenix_company_id = ${companyId}
          AND fenix_user_id = ${userId}
        LIMIT 1
      `,
  });

  const readScopedProjectByWorkspaceRoot = SqlSchema.findOneOption({
    Request: WorkspaceScopeInput,
    Result: ScopedProjectIdRow,
    execute: ({ companyId, userId, workspaceRoot }) =>
      sql`
        SELECT project_id AS "projectId"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND fenix_company_id = ${companyId}
          AND fenix_user_id = ${userId}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
        LIMIT 1
      `,
  });

  const readScopedThreadProject = SqlSchema.findOneOption({
    Request: ThreadScopeInput,
    Result: ScopedProjectIdRow,
    execute: ({ companyId, userId, threadId }) =>
      sql`
        SELECT projects.project_id AS "projectId"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND projects.fenix_company_id = ${companyId}
          AND projects.fenix_user_id = ${userId}
        LIMIT 1
      `,
  });

  const searchScopedActiveThreadRows = SqlSchema.findAll({
    Request: ScopedSearchInput,
    Result: ScopedSearchRow,
    execute: ({ companyId, userId, pattern, limit }) =>
      sql`
        WITH ranked AS (
          SELECT
            threads.thread_id AS thread_id,
            threads.project_id AS project_id,
            CASE messages.role
              WHEN 'user' THEN 'user'
              ELSE 'assistant'
            END AS source,
            messages.text AS match_text,
            messages.created_at AS message_created_at,
            CASE messages.role
              WHEN 'user' THEN 0
              ELSE 1
            END AS match_rank,
            threads.updated_at AS thread_updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY threads.thread_id
              ORDER BY
                CASE messages.role
                  WHEN 'user' THEN 0
                  ELSE 1
                END ASC,
                messages.created_at DESC,
                messages.message_id ASC
            ) AS thread_match_rank
          FROM projection_thread_messages AS messages
          INNER JOIN projection_threads AS threads
            ON threads.thread_id = messages.thread_id
          INNER JOIN projection_projects AS projects
            ON projects.project_id = threads.project_id
          WHERE threads.deleted_at IS NULL
            AND threads.archived_at IS NULL
            AND projects.deleted_at IS NULL
            AND projects.fenix_company_id = ${companyId}
            AND projects.fenix_user_id = ${userId}
            AND messages.is_streaming = 0
            AND (
              messages.role = 'user'
              OR (
                messages.role = 'assistant'
                AND messages.message_id IN (
                  SELECT turns.assistant_message_id
                  FROM projection_turns AS turns
                  WHERE turns.assistant_message_id IS NOT NULL
                )
              )
            )
            AND messages.text LIKE ${pattern} ESCAPE '!'
        )
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          source,
          match_text AS "matchText",
          message_created_at AS "messageCreatedAt"
        FROM ranked
        WHERE thread_match_rank = 1
        ORDER BY
          match_rank ASC,
          thread_updated_at DESC,
          thread_id ASC
        LIMIT ${limit}
      `,
  });

  const claimScopedProjectRow = SqlSchema.findOneOption({
    Request: ProjectScopeInput,
    Result: ScopedProjectIdRow,
    execute: ({ companyId, userId, projectId }) =>
      sql`
        UPDATE projection_projects
        SET
          fenix_company_id = ${companyId},
          fenix_user_id = ${userId}
        WHERE project_id = ${projectId}
          AND (
            (fenix_company_id IS NULL AND fenix_user_id IS NULL)
            OR (fenix_company_id = ${companyId} AND fenix_user_id = ${userId})
          )
        RETURNING project_id AS "projectId"
      `,
  });

  const scopedProjectIds = (scope: FenixCodeTenantScope) =>
    isValidFenixCodeTenantScope(scope)
      ? listScopedProjectRows(scope).pipe(
          Effect.mapError(toPersistenceSqlError("FenixScopedProjectionSnapshotQuery.listProjects")),
          Effect.map(projectIdSet),
        )
      : Effect.succeed(new Set<string>());

  const projectMatchesScope = (scope: FenixCodeTenantScope, projectId: ProjectId) =>
    isValidFenixCodeTenantScope(scope)
      ? readScopedProject({ ...scope, projectId }).pipe(
          Effect.mapError(toPersistenceSqlError("FenixScopedProjectionSnapshotQuery.readProject")),
          Effect.map(Option.isSome),
        )
      : Effect.succeed(false);

  const threadMatchesScope = (scope: FenixCodeTenantScope, threadId: ThreadId) =>
    isValidFenixCodeTenantScope(scope)
      ? readScopedThreadProject({ ...scope, threadId }).pipe(
          Effect.mapError(toPersistenceSqlError("FenixScopedProjectionSnapshotQuery.readThread")),
          Effect.map(Option.isSome),
        )
      : Effect.succeed(false);

  const withScopedProjects = <A, E, R>(
    scope: FenixCodeTenantScope,
    effect: (projectIds: ReadonlySet<string>) => Effect.Effect<A, E, R>,
    empty: () => Effect.Effect<A, E, R>,
  ) =>
    scopedProjectIds(scope).pipe(
      Effect.flatMap((projectIds) => (projectIds.size === 0 ? empty() : effect(projectIds))),
    );

  const emptyReadModelAtCurrentSequence = () =>
    baseQuery
      .getSnapshotSequence()
      .pipe(Effect.map(({ snapshotSequence }) => emptyReadModel(snapshotSequence)));

  const emptyShellSnapshotAtCurrentSequence = () =>
    baseQuery
      .getSnapshotSequence()
      .pipe(Effect.map(({ snapshotSequence }) => emptyShellSnapshot(snapshotSequence)));

  const getSnapshot: FenixScopedProjectionSnapshotQueryShape["getSnapshot"] = (scope) =>
    withScopedProjects(
      scope,
      (projectIds) =>
        baseQuery
          .getSnapshot()
          .pipe(Effect.map((snapshot) => filterReadModelByProjects(snapshot, projectIds))),
      emptyReadModelAtCurrentSequence,
    );

  const getCommandReadModel: FenixScopedProjectionSnapshotQueryShape["getCommandReadModel"] = (
    scope,
  ) =>
    withScopedProjects(
      scope,
      (projectIds) =>
        baseQuery
          .getCommandReadModel()
          .pipe(Effect.map((snapshot) => filterReadModelByProjects(snapshot, projectIds))),
      emptyReadModelAtCurrentSequence,
    );

  const getShellSnapshot: FenixScopedProjectionSnapshotQueryShape["getShellSnapshot"] = (scope) =>
    withScopedProjects(
      scope,
      (projectIds) =>
        baseQuery
          .getShellSnapshot()
          .pipe(Effect.map((snapshot) => filterShellByProjects(snapshot, projectIds))),
      emptyShellSnapshotAtCurrentSequence,
    );

  const getArchivedShellSnapshot: FenixScopedProjectionSnapshotQueryShape["getArchivedShellSnapshot"] =
    (scope) =>
      withScopedProjects(
        scope,
        (projectIds) =>
          baseQuery
            .getArchivedShellSnapshot()
            .pipe(Effect.map((snapshot) => filterShellByProjects(snapshot, projectIds))),
        emptyShellSnapshotAtCurrentSequence,
      );

  const searchThreads: FenixScopedProjectionSnapshotQueryShape["searchThreads"] = (scope, input) =>
    isValidFenixCodeTenantScope(scope)
      ? searchScopedActiveThreadRows({
          ...scope,
          pattern: `%${escapeLikePattern(input.query)}%`,
          limit: input.limit ?? 50,
        }).pipe(
          Effect.mapError(toPersistenceSqlError("FenixScopedProjectionSnapshotQuery.search")),
          Effect.map(
            (rows): OrchestrationSearchThreadsResult => ({
              matches: rows.map((row) => ({
                threadId: ThreadId.make(row.threadId),
                projectId: ProjectId.make(row.projectId),
                source: row.source,
                snippet: buildSearchSnippet(row.matchText, input.query),
                messageCreatedAt: row.messageCreatedAt,
              })),
            }),
          ),
        )
      : Effect.succeed({ matches: [] });

  const projectBelongsToScope: FenixScopedProjectionSnapshotQueryShape["projectBelongsToScope"] =
    projectMatchesScope;

  const claimProjectScope: FenixScopedProjectionSnapshotQueryShape["claimProjectScope"] = (
    scope,
    projectId,
  ) =>
    isValidFenixCodeTenantScope(scope)
      ? claimScopedProjectRow({ ...scope, projectId }).pipe(
          Effect.mapError(
            toPersistenceSqlError("FenixScopedProjectionSnapshotQuery.claimProjectScope"),
          ),
          Effect.map(Option.isSome),
        )
      : Effect.succeed(false);

  const threadBelongsToScope: FenixScopedProjectionSnapshotQueryShape["threadBelongsToScope"] =
    threadMatchesScope;

  const getCounts: FenixScopedProjectionSnapshotQueryShape["getCounts"] = (scope) =>
    isValidFenixCodeTenantScope(scope)
      ? readScopedCounts(scope).pipe(
          Effect.mapError(toPersistenceSqlError("FenixScopedProjectionSnapshotQuery.getCounts")),
          Effect.map(
            (row): ProjectionSnapshotCounts => ({
              projectCount: row.projectCount,
              threadCount: row.threadCount,
            }),
          ),
        )
      : Effect.succeed({ projectCount: 0, threadCount: 0 });

  const getActiveProjectByWorkspaceRoot: FenixScopedProjectionSnapshotQueryShape["getActiveProjectByWorkspaceRoot"] =
    (scope, workspaceRoot) =>
      isValidFenixCodeTenantScope(scope)
        ? readScopedProjectByWorkspaceRoot({ ...scope, workspaceRoot }).pipe(
            Effect.mapError(
              toPersistenceSqlError("FenixScopedProjectionSnapshotQuery.readWorkspaceRoot"),
            ),
            Effect.flatMap((project) =>
              Option.isSome(project)
                ? baseQuery.getSnapshot().pipe(
                    Effect.map((snapshot) => {
                      const scopedProject = snapshot.projects.find(
                        (candidate) => candidate.id === ProjectId.make(project.value.projectId),
                      );
                      return scopedProject === undefined
                        ? Option.none<OrchestrationProject>()
                        : Option.some(scopedProject);
                    }),
                  )
                : Effect.succeed(Option.none()),
            ),
          )
        : Effect.succeed(Option.none());

  const getProjectShellById: FenixScopedProjectionSnapshotQueryShape["getProjectShellById"] = (
    scope,
    projectId,
  ) =>
    projectMatchesScope(scope, projectId).pipe(
      Effect.flatMap((matches) =>
        matches ? baseQuery.getProjectShellById(projectId) : Effect.succeed(Option.none()),
      ),
    );

  const getFirstActiveThreadIdByProjectId: FenixScopedProjectionSnapshotQueryShape["getFirstActiveThreadIdByProjectId"] =
    (scope, projectId) =>
      projectMatchesScope(scope, projectId).pipe(
        Effect.flatMap((matches) =>
          matches
            ? baseQuery.getFirstActiveThreadIdByProjectId(projectId)
            : Effect.succeed(Option.none()),
        ),
      );

  const getThreadCheckpointContext: FenixScopedProjectionSnapshotQueryShape["getThreadCheckpointContext"] =
    (scope, threadId) =>
      threadMatchesScope(scope, threadId).pipe(
        Effect.flatMap((matches) =>
          matches ? baseQuery.getThreadCheckpointContext(threadId) : Effect.succeed(Option.none()),
        ),
      );

  const getFullThreadDiffContext: FenixScopedProjectionSnapshotQueryShape["getFullThreadDiffContext"] =
    (scope, threadId, toTurnCount) =>
      threadMatchesScope(scope, threadId).pipe(
        Effect.flatMap((matches) =>
          matches
            ? baseQuery.getFullThreadDiffContext(threadId, toTurnCount)
            : Effect.succeed(Option.none()),
        ),
      );

  const getThreadShellById: FenixScopedProjectionSnapshotQueryShape["getThreadShellById"] = (
    scope,
    threadId,
  ) =>
    threadMatchesScope(scope, threadId).pipe(
      Effect.flatMap((matches) =>
        matches ? baseQuery.getThreadShellById(threadId) : Effect.succeed(Option.none()),
      ),
    );

  const getThreadDetailById: FenixScopedProjectionSnapshotQueryShape["getThreadDetailById"] = (
    scope,
    threadId,
  ) =>
    threadMatchesScope(scope, threadId).pipe(
      Effect.flatMap((matches) =>
        matches ? baseQuery.getThreadDetailById(threadId) : Effect.succeed(Option.none()),
      ),
    );

  const getThreadDetailSnapshot: FenixScopedProjectionSnapshotQueryShape["getThreadDetailSnapshot"] =
    (scope, threadId, window) =>
      threadMatchesScope(scope, threadId).pipe(
        Effect.flatMap((matches) =>
          matches
            ? baseQuery.getThreadDetailSnapshot(threadId, window)
            : Effect.succeed(Option.none()),
        ),
      );

  return {
    claimProjectScope,
    getCommandReadModel,
    getSnapshot,
    getShellSnapshot,
    getArchivedShellSnapshot,
    searchThreads,
    projectBelongsToScope,
    threadBelongsToScope,
    getSnapshotSequence: baseQuery.getSnapshotSequence,
    getCounts,
    getActiveProjectByWorkspaceRoot,
    getProjectShellById,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
    getFullThreadDiffContext,
    getThreadShellById,
    getThreadDetailById,
    getThreadDetailSnapshot,
  } satisfies FenixScopedProjectionSnapshotQueryShape;
});

export const FenixScopedProjectionSnapshotQueryLive = Layer.effect(
  FenixScopedProjectionSnapshotQuery,
  makeFenixScopedProjectionSnapshotQuery,
);
