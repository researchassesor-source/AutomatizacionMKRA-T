import { describe, expect, it, vi } from "vitest";
import {
  COURSE_CAPTURE_REQUIRED_COLUMNS,
  COURSE_SCHEDULE_REQUIRED_COLUMNS,
  CRM_AUTOMATION_REQUIRED_COLUMNS,
  CRM_AUTOMATION_TABLES,
  REPOSITORY_MIGRATIONS,
} from "../../scripts/prepare-preview-migrations.mjs";
import { verifyDatabaseSchema } from "../../scripts/verify-database-schema.mjs";

const requiredTables = [
  "_prisma_migrations",
  "admin_users",
  "audit_logs",
  "courses",
  "enrollments",
  "follow_ups",
  "lead_notes",
  "leads",
  "outbound_messages",
  ...CRM_AUTOMATION_TABLES,
];
const requiredColumns = [
  "courses.category",
  "admin_users.id",
  ...COURSE_SCHEDULE_REQUIRED_COLUMNS,
  ...COURSE_CAPTURE_REQUIRED_COLUMNS,
  ...CRM_AUTOMATION_REQUIRED_COLUMNS,
];

function prismaSnapshot(options: {
  tables?: string[];
  columns?: string[];
  migrations?: Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>;
} = {}) {
  const tables = options.tables ?? requiredTables;
  const columns = options.columns ?? requiredColumns;
  const migrations = options.migrations ?? REPOSITORY_MIGRATIONS.map((migration_name) => ({
    migration_name,
    finished_at: new Date("2026-08-03T00:00:00.000Z"),
    rolled_back_at: null,
  }));
  return {
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => {
      const sql = query.join("");
      if (sql.includes("information_schema.tables")) return tables.map((table_name) => ({ table_name }));
      if (sql.includes("information_schema.columns")) {
        return columns.map((column) => {
          const [table_name, column_name] = column.split(".");
          return { table_name, column_name };
        });
      }
      return migrations;
    }),
  };
}

describe("verificacion final del esquema", () => {
  it("acepta todas las migraciones y columnas actuales", async () => {
    await expect(verifyDatabaseSchema(prismaSnapshot() as never)).resolves.toBeUndefined();
  });

  it("rechaza una columna de captacion o agenda ausente", async () => {
    for (const missing of ["courses.startsAt", "leads.utmContent", "enrollments.referrer"]) {
      const columns = requiredColumns.filter((column) => column !== missing);
      await expect(verifyDatabaseSchema(prismaSnapshot({ columns }) as never)).rejects.toThrow(missing);
    }
  });

  it("rechaza una migracion del repositorio ausente", async () => {
    const migrations = REPOSITORY_MIGRATIONS.slice(0, -1).map((migration_name) => ({
      migration_name,
      finished_at: new Date("2026-08-03T00:00:00.000Z"),
      rolled_back_at: null,
    }));
    await expect(verifyDatabaseSchema(prismaSnapshot({ migrations }) as never)).rejects.toThrow(REPOSITORY_MIGRATIONS.at(-1));
  });

  it("rechaza una migracion desconocida o incompleta", async () => {
    const valid = REPOSITORY_MIGRATIONS.map((migration_name) => ({
      migration_name,
      finished_at: new Date("2026-08-03T00:00:00.000Z"),
      rolled_back_at: null,
    }));
    await expect(verifyDatabaseSchema(prismaSnapshot({
      migrations: [...valid, { migration_name: "20990101000000_unknown", finished_at: new Date(), rolled_back_at: null }],
    }) as never)).rejects.toThrow("ajenas al repositorio");
    await expect(verifyDatabaseSchema(prismaSnapshot({
      migrations: [{ ...valid[0], finished_at: null }, ...valid.slice(1)],
    }) as never)).rejects.toThrow("incompleta");
  });
});
