import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  COURSE_CAPTURE_REQUIRED_COLUMNS,
  COURSE_SCHEDULE_REQUIRED_COLUMNS,
  CRM_AUTOMATION_REQUIRED_COLUMNS,
  CRM_AUTOMATION_TABLES,
  REPOSITORY_MIGRATIONS,
} from "./prepare-preview-migrations.mjs";

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
  ...CRM_AUTOMATION_TABLES,
];

const REQUIRED_COLUMNS = [
  "courses.category",
  "admin_users.id",
  ...COURSE_SCHEDULE_REQUIRED_COLUMNS,
  ...COURSE_CAPTURE_REQUIRED_COLUMNS,
  ...CRM_AUTOMATION_REQUIRED_COLUMNS,
];

export async function verifyDatabaseSchema(prisma) {
  const tables = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const tableNames = new Set(tables.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
  if (missingTables.length) throw new Error(`Faltan tablas críticas: ${missingTables.join(", ")}.`);

  const columns = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const columnNames = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = REQUIRED_COLUMNS.filter((name) => !columnNames.has(name));
  if (missingColumns.length) throw new Error(`Faltan columnas críticas: ${missingColumns.join(", ")}.`);

  const migrations = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
  `;
  const failedMigrations = migrations.filter((row) => row.finished_at === null || row.rolled_back_at !== null);
  if (failedMigrations.length) {
    throw new Error("Existe una migracion fallida, revertida o incompleta.");
  }
  const applied = new Set(migrations.map((row) => row.migration_name));
  const unknownMigrations = [...applied].filter((name) => !REPOSITORY_MIGRATIONS.includes(name));
  if (unknownMigrations.length) {
    throw new Error(`Existen migraciones ajenas al repositorio: ${unknownMigrations.join(", ")}.`);
  }
  const missingMigrations = REPOSITORY_MIGRATIONS.filter((name) => !applied.has(name));
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
