import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const hasColumn = (rows: ReadonlyArray<{ readonly name: string }>, columnName: string): boolean =>
  rows.some((row) => row.name === columnName);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;

  if (!hasColumn(projectColumns, "fenix_company_id")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN fenix_company_id INTEGER
    `;
  }

  if (!hasColumn(projectColumns, "fenix_user_id")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN fenix_user_id INTEGER
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_projects_fenix_scope_active
    ON projection_projects(fenix_company_id, fenix_user_id, deleted_at, project_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_projects_fenix_scope_workspace
    ON projection_projects(fenix_company_id, fenix_user_id, workspace_root)
  `;
});
