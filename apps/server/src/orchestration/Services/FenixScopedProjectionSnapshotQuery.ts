import type {
  OrchestrationReadModel,
  OrchestrationSearchThreadsInput,
  OrchestrationSearchThreadsResult,
  OrchestrationShellSnapshot,
  OrchestrationProject,
  OrchestrationProjectShell,
  OrchestrationThread,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadDetailWindow,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { FenixCodeTenantScope } from "../../fenix/FenixCodeTenantScope.ts";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type {
  ProjectionFullThreadDiffContext,
  ProjectionSnapshotCounts,
  ProjectionSnapshotSequence,
  ProjectionThreadCheckpointContext,
} from "./ProjectionSnapshotQuery.ts";

export interface FenixScopedProjectionSnapshotQueryShape {
  readonly getCommandReadModel: (
    scope: FenixCodeTenantScope,
  ) => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;
  readonly getSnapshot: (
    scope: FenixCodeTenantScope,
  ) => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;
  readonly getShellSnapshot: (
    scope: FenixCodeTenantScope,
  ) => Effect.Effect<OrchestrationShellSnapshot, ProjectionRepositoryError>;
  readonly getArchivedShellSnapshot: (
    scope: FenixCodeTenantScope,
  ) => Effect.Effect<OrchestrationShellSnapshot, ProjectionRepositoryError>;
  readonly searchThreads: (
    scope: FenixCodeTenantScope,
    input: OrchestrationSearchThreadsInput,
  ) => Effect.Effect<OrchestrationSearchThreadsResult, ProjectionRepositoryError>;
  readonly projectBelongsToScope: (
    scope: FenixCodeTenantScope,
    projectId: ProjectId,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly threadBelongsToScope: (
    scope: FenixCodeTenantScope,
    threadId: ThreadId,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly getSnapshotSequence: () => Effect.Effect<
    ProjectionSnapshotSequence,
    ProjectionRepositoryError
  >;
  readonly getCounts: (
    scope: FenixCodeTenantScope,
  ) => Effect.Effect<ProjectionSnapshotCounts, ProjectionRepositoryError>;
  readonly getActiveProjectByWorkspaceRoot: (
    scope: FenixCodeTenantScope,
    workspaceRoot: string,
  ) => Effect.Effect<Option.Option<OrchestrationProject>, ProjectionRepositoryError>;
  readonly getProjectShellById: (
    scope: FenixCodeTenantScope,
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<OrchestrationProjectShell>, ProjectionRepositoryError>;
  readonly getFirstActiveThreadIdByProjectId: (
    scope: FenixCodeTenantScope,
    projectId: ProjectId,
  ) => Effect.Effect<Option.Option<ThreadId>, ProjectionRepositoryError>;
  readonly getThreadCheckpointContext: (
    scope: FenixCodeTenantScope,
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProjectionThreadCheckpointContext>, ProjectionRepositoryError>;
  readonly getFullThreadDiffContext: (
    scope: FenixCodeTenantScope,
    threadId: ThreadId,
    toTurnCount: number,
  ) => Effect.Effect<Option.Option<ProjectionFullThreadDiffContext>, ProjectionRepositoryError>;
  readonly getThreadShellById: (
    scope: FenixCodeTenantScope,
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadShell>, ProjectionRepositoryError>;
  readonly getThreadDetailById: (
    scope: FenixCodeTenantScope,
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThread>, ProjectionRepositoryError>;
  readonly getThreadDetailSnapshot: (
    scope: FenixCodeTenantScope,
    threadId: ThreadId,
    window?: OrchestrationThreadDetailWindow,
  ) => Effect.Effect<Option.Option<OrchestrationThreadDetailSnapshot>, ProjectionRepositoryError>;
}

export class FenixScopedProjectionSnapshotQuery extends Context.Service<
  FenixScopedProjectionSnapshotQuery,
  FenixScopedProjectionSnapshotQueryShape
>()("t3/orchestration/Services/FenixScopedProjectionSnapshotQuery") {}
