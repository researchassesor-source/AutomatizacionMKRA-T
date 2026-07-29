import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const REQUIRED_TABLES = [
  "_prisma_migrations",
  "admin_users",
  "audit_logs",
  "courses",
  "enrollments",
  "follow_ups",
  "lead_notes",
  "leads",
  "outbound_messages",
];

const REQUIRED_MIGRATIONS = [
  "20260728000000_baseline_b1ca4fe",
  "20260728010000_crm_release_candidate",
];

export async function verifyDatabaseSchema(prisma) {
  const tables = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        '_prisma_migrations', 'admin_users', 'audit_logs', 'courses',
        'enrollments', 'follow_ups', 'lead_notes', 'leads', 'outbound_messages'
      )
  `;
  const tableNames = new Set(tables.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
  if (missingTables.length) throw new Error(`Faltan tablas críticas: ${missingTables.join(", ")}.`);

  const columns = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'courses' AND column_name = 'category') OR
        (table_name = 'admin_users' AND column_name = 'id')
      )
  `;
  const columnNames = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = ["courses.category", "admin_users.id"].filter((name) => !columnNames.has(name));
  if (missingColumns.length) throw new Error(`Faltan columnas críticas: ${missingColumns.join(", ")}.`);

  const migrations = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE migration_name IN (
      '20260728000000_baseline_b1ca4fe',
      '20260728010000_crm_release_candidate'
    )
  `;
  const applied = new Set(
    migrations
      .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
      .map((row) => row.migration_name),
  );
  const missingMigrations = REQUIRED_MIGRATIONS.filter((name) => !applied.has(name));
  if (missingMigrations.length) {
    throw new Error(`Faltan migraciones aplicadas: ${missingMigrations.join(", ")}.`);
  }
}

async function main() {
  const directUrl = process.env.POSTGRES_URL_NON_POOLING?.trim();
  if (!directUrl) throw new Error("Falta la variable POSTGRES_URL_NON_POOLING.");
  const prisma = new PrismaClient({ datasourceUrl: directUrl });
  try {
    await verifyDatabaseSchema(prisma);
    console.log("[schema-check] Estructuras críticas verificadas en modo de solo lectura.");
  } finally {
    await prisma.$disconnect();
  }
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(`[schema-check] ${error instanceof Error ? error.message : "La verificación falló."}`);
    process.exitCode = 1;
  });
}
