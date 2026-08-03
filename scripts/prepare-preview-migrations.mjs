import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export const BASELINE_MIGRATION = "20260728000000_baseline_b1ca4fe";
export const RELEASE_MIGRATION = "20260728010000_crm_release_candidate";
export const COURSE_SCHEDULE_MIGRATION = "20260729010000_course_schedule_fields";
export const COURSE_CAPTURE_MIGRATION = "20260803010000_course_capture_campaign";
export const CRM_AUTOMATION_MIGRATION = "20260803130000_crm_automation_foundation";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIRECTORY = resolve(SCRIPT_DIRECTORY, "../prisma/migrations");

export function discoverRepositoryMigrations(directory = MIGRATIONS_DIRECTORY) {
  const migrations = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  for (const migration of migrations) {
    if (!existsSync(resolve(directory, migration, "migration.sql"))) {
      throw new Error(`Carpeta de migración inválida: ${migration}.`);
    }
  }
  return migrations;
}

export const REPOSITORY_MIGRATIONS = Object.freeze(discoverRepositoryMigrations());

export const BASELINE_TABLE_COLUMNS = Object.freeze({
  courses: [
    "id", "slug", "title", "subtitle", "description", "isFree", "isPublished",
    "benefits", "duration", "hasCertificate", "createdAt", "updatedAt",
  ],
  leads: [
    "id", "fullName", "email", "phone", "source", "utmSource", "utmMedium",
    "utmCampaign", "stage", "courseId", "consent", "createdAt", "updatedAt",
    "financeInscripcionId", "score", "scoreBreakdown", "scoredAt",
  ],
  lead_events: ["id", "leadId", "type", "payload", "createdAt"],
  social_accounts: ["id", "platform", "displayName", "externalId", "accessToken", "isActive", "createdAt"],
  social_posts: [
    "id", "accountId", "caption", "mediaUrl", "linkUrl", "status", "scheduledAt",
    "publishedAt", "externalPostId", "error", "createdAt", "updatedAt",
  ],
  outbound_messages: [
    "id", "leadId", "channel", "toAddress", "subject", "body", "status",
    "scheduledAt", "sentAt", "error", "sequenceKey", "stepKey", "createdAt",
  ],
});

export const INCREMENTAL_TABLES = Object.freeze([
  "admin_users",
  "enrollments",
  "lead_notes",
  "follow_ups",
  "audit_logs",
  "message_templates",
  "social_schedules",
]);

export const INCREMENTAL_REQUIRED_COLUMNS = Object.freeze([
  "courses.category", "courses.displayOrder", "courses.imageUrl", "courses.isLeadMagnet",
  "courses.moodleCourseUrl", "courses.officialCourseUrl", "courses.price",
  "leads.archivedAt", "leads.assignedToId", "leads.consentAt", "leads.consentPolicyVersion",
  "leads.consentPurpose", "leads.firstName", "leads.isArchived", "leads.landingUrl",
  "leads.lastName", "leads.lostReason", "leads.nextActionAt", "leads.referrer",
  "lead_events.enrollmentId", "lead_events.idempotencyKey",
  "social_accounts.updatedAt",
  "social_posts.cancelledAt", "social_posts.duplicatedFromId", "social_posts.occurrenceKey",
  "social_posts.publishStartedAt", "social_posts.retryCount", "social_posts.scheduleId",
  "outbound_messages.attempts", "outbound_messages.cancelledAt", "outbound_messages.enrollmentId",
  "outbound_messages.isSimulation", "outbound_messages.templateId", "outbound_messages.updatedAt",
  "admin_users.id", "admin_users.passwordHash", "admin_users.role",
  "enrollments.id", "enrollments.leadId", "enrollments.courseId", "enrollments.status",
  "lead_notes.id", "lead_notes.leadId", "lead_notes.content",
  "follow_ups.id", "follow_ups.leadId", "follow_ups.type", "follow_ups.dueAt", "follow_ups.status",
  "audit_logs.id", "audit_logs.action", "audit_logs.entityType", "audit_logs.result",
  "message_templates.id", "message_templates.name", "message_templates.channel", "message_templates.body",
  "social_schedules.id", "social_schedules.accountId", "social_schedules.weekday",
  "social_schedules.localTime", "social_schedules.nextRunAt",
]);

export const COURSE_SCHEDULE_REQUIRED_COLUMNS = Object.freeze([
  "courses.modality",
  "courses.startsAt",
  "courses.endsAt",
]);

export const COURSE_CAPTURE_REQUIRED_COLUMNS = Object.freeze([
  "courses.acceptsRegistrations",
  "leads.utmContent",
  "leads.utmTerm",
  "enrollments.utmContent",
  "enrollments.utmTerm",
  "enrollments.referrer",
]);

export const CRM_AUTOMATION_TABLES = Object.freeze([
  "automation_rules",
  "campaigns",
  "catalog_sync_runs",
  "message_provider_events",
  "rate_limit_buckets",
]);

export const CRM_AUTOMATION_REQUIRED_COLUMNS = Object.freeze([
  "leads.classification",
  "courses.externalId", "courses.externalSource", "courses.officialSlug", "courses.crmSlug",
  "courses.officialUrl", "courses.lastSyncedAt", "courses.sourceUpdatedAt", "courses.syncStatus", "courses.syncError",
  "enrollments.campaignId",
  "outbound_messages.automationRuleId", "outbound_messages.providerMessageId", "outbound_messages.providerResponse",
  "outbound_messages.acceptedAt", "outbound_messages.deliveredAt", "outbound_messages.bouncedAt",
  "outbound_messages.failedAt", "outbound_messages.errorCode", "outbound_messages.errorMessage",
  "outbound_messages.attemptCount", "outbound_messages.lastAttemptAt", "outbound_messages.nextAttemptAt",
  "social_accounts.connectionStatus", "social_accounts.connectionCheckedAt", "social_accounts.connectionError",
  "social_posts.providerPostUrl", "social_posts.providerResponse", "social_posts.errorCode", "social_posts.errorMessage",
  "automation_rules.id", "campaigns.id", "catalog_sync_runs.id", "message_provider_events.id", "rate_limit_buckets.key",
]);

const PREVIEW_FLAG = "PREVIEW_DATABASE_MIGRATIONS_ENABLED";
const DIRECT_URL = "POSTGRES_URL_NON_POOLING";
const HISTORY_TABLE = "_prisma_migrations";
const BASELINE_TABLES = Object.keys(BASELINE_TABLE_COLUMNS);
const CORE_FINAL_TABLES = new Set([...BASELINE_TABLES, ...INCREMENTAL_TABLES]);
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve("prisma/build/index.js");

function sanitize(text, env) {
  let output = String(text ?? "");
  output = output.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[DATABASE_URL_REDACTED]");
  for (const [name, value] of Object.entries(env)) {
    if (!value || !/(PASSWORD|SECRET|TOKEN|DATABASE_URL|POSTGRES.*URL|AUTHORIZATION|COOKIE)/i.test(name)) continue;
    output = output.split(value).join(`[${name}_REDACTED]`);
  }
  return output;
}

function fail(message) {
  throw new Error(`Base Preview no segura para baseline automático: ${message}`);
}

function exactBaselineSchema(tables, columns) {
  const businessTables = [...tables].filter((table) => table !== HISTORY_TABLE);
  if (businessTables.length !== BASELINE_TABLES.length) return false;
  if (!BASELINE_TABLES.every((table) => tables.has(table))) return false;
  return BASELINE_TABLES.every((table) => {
    const actual = [...columns]
      .filter((column) => column.startsWith(`${table}.`))
      .map((column) => column.slice(table.length + 1));
    const expected = BASELINE_TABLE_COLUMNS[table];
    return actual.length === expected.length && expected.every((column) => actual.includes(column));
  });
}

function hasExactlyRequiredStageColumns(columns, requiredColumns, required) {
  const presentCount = requiredColumns.filter((column) => columns.has(column)).length;
  return required ? presentCount === requiredColumns.length : presentCount === 0;
}

function completeIncrementalSchema(
  tables,
  columns,
  { requireSchedule, requireCourseCapture, requireAutomation, allowAdditionalTables = false },
) {
  const businessTables = [...tables].filter((table) => table !== HISTORY_TABLE);
  const expectedTables = new Set([...CORE_FINAL_TABLES, ...(requireAutomation ? CRM_AUTOMATION_TABLES : [])]);
  if (!allowAdditionalTables && !businessTables.every((table) => expectedTables.has(table))) return false;
  if (![...expectedTables].every((table) => tables.has(table))) return false;
  if (!requireAutomation && CRM_AUTOMATION_TABLES.some((table) => tables.has(table))) return false;
  const baselineColumnsRemain = Object.entries(BASELINE_TABLE_COLUMNS)
    .every(([table, expected]) => expected.every((column) => columns.has(`${table}.${column}`)));
  if (!baselineColumnsRemain || !INCREMENTAL_REQUIRED_COLUMNS.every((column) => columns.has(column))) return false;
  return hasExactlyRequiredStageColumns(columns, COURSE_SCHEDULE_REQUIRED_COLUMNS, requireSchedule)
    && hasExactlyRequiredStageColumns(columns, COURSE_CAPTURE_REQUIRED_COLUMNS, requireCourseCapture)
    && hasExactlyRequiredStageColumns(columns, CRM_AUTOMATION_REQUIRED_COLUMNS, requireAutomation);
}

function validateRepositoryMigrations(repositoryMigrations) {
  const baselineIndex = repositoryMigrations.indexOf(BASELINE_MIGRATION);
  const releaseIndex = repositoryMigrations.indexOf(RELEASE_MIGRATION);
  const scheduleIndex = repositoryMigrations.indexOf(COURSE_SCHEDULE_MIGRATION);
  const captureIndex = repositoryMigrations.indexOf(COURSE_CAPTURE_MIGRATION);
  const automationIndex = repositoryMigrations.indexOf(CRM_AUTOMATION_MIGRATION);
  if (
    baselineIndex !== 0
    || releaseIndex <= baselineIndex
    || scheduleIndex <= releaseIndex
    || captureIndex <= scheduleIndex
    || automationIndex <= captureIndex
  ) {
    fail("el repositorio no contiene la secuencia de migraciones obligatoria en orden lógico.");
  }
  return { releaseIndex, scheduleIndex, captureIndex, automationIndex };
}

function validateMigrationHistory(migrations, repositoryMigrations) {
  const knownMigrations = new Set(repositoryMigrations);
  if (new Set(migrations.map((migration) => migration.name)).size !== migrations.length) {
    fail("el historial contiene registros de migración duplicados.");
  }
  if (migrations.some((migration) => !knownMigrations.has(migration.name))) {
    fail("el historial contiene migraciones desconocidas.");
  }
  if (migrations.some((migration) => !migration.applied)) {
    fail("existe una migración fallida, revertida o incompleta.");
  }

  const applied = new Set(migrations.map((migration) => migration.name));
  let foundGap = false;
  for (const migration of repositoryMigrations) {
    if (!applied.has(migration)) {
      foundGap = true;
    } else if (foundGap) {
      fail("el historial contiene migraciones aplicadas fuera de orden lógico.");
    }
  }
  return applied.size;
}

export function classifyPreviewDatabase(snapshot, repositoryMigrations = REPOSITORY_MIGRATIONS) {
  const { releaseIndex, scheduleIndex, captureIndex, automationIndex } = validateRepositoryMigrations(repositoryMigrations);
  const tables = new Set(snapshot.tables);
  const columns = new Set(snapshot.columns);
  const migrations = snapshot.migrations ?? [];
  const appliedCount = validateMigrationHistory(migrations, repositoryMigrations);

  const businessTables = [...tables].filter((table) => table !== HISTORY_TABLE);
  if (businessTables.length === 0) {
    if (appliedCount !== 0) fail("el historial no coincide con una base vacía.");
    return { mode: "empty" };
  }

  const baselineCompatible = exactBaselineSchema(tables, columns);
  if (appliedCount === 0) {
    if (baselineCompatible) return { mode: "resolve-baseline" };
    fail("el esquema es ambiguo, parcial o contiene estructuras incrementales sin historial compatible.");
  }

  if (appliedCount === 1) {
    if (!baselineCompatible) fail("el baseline registrado no coincide exactamente con el esquema histórico.");
    return { mode: "baseline-recorded" };
  }

  const scheduleApplied = appliedCount > scheduleIndex;
  const courseCaptureApplied = appliedCount > captureIndex;
  const automationApplied = appliedCount > automationIndex;
  const appliedMigrations = repositoryMigrations.slice(0, appliedCount);
  const additionalSchemaMigrationsApplied = appliedMigrations.some((migration) => ![
    BASELINE_MIGRATION,
    RELEASE_MIGRATION,
    COURSE_SCHEDULE_MIGRATION,
    COURSE_CAPTURE_MIGRATION,
    CRM_AUTOMATION_MIGRATION,
  ].includes(migration));
  const compatible = completeIncrementalSchema(tables, columns, {
    requireSchedule: scheduleApplied,
    requireCourseCapture: courseCaptureApplied,
    requireAutomation: automationApplied,
    allowAdditionalTables: additionalSchemaMigrationsApplied,
  });
  if (!compatible) {
    const stage = automationApplied
      ? "final de automatización CRM"
      : courseCaptureApplied
        ? "incremental previo a crm_automation_foundation"
      : scheduleApplied
        ? "incremental previo a course_capture_campaign"
        : "incremental previo a course_schedule_fields";
    fail(`el historial no coincide con el esquema ${stage}.`);
  }

  if (appliedCount === repositoryMigrations.length) return { mode: "up-to-date" };
  if (appliedCount <= releaseIndex) {
    fail("el historial no alcanza el estado incremental mínimo esperado.");
  }
  return { mode: "migrations-pending" };
}

export async function inspectPreviewDatabase(prisma) {
  const tableRows = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  const tables = tableRows.map((row) => row.table_name);
  const columnRows = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const columns = columnRows.map((row) => `${row.table_name}.${row.column_name}`);
  let migrations = [];
  if (tables.includes(HISTORY_TABLE)) {
    const rows = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
    `;
    migrations = rows.map((row) => ({
      name: row.migration_name,
      applied: row.finished_at !== null && row.rolled_back_at === null,
    }));
  }
  return { tables, columns, migrations };
}

export async function preparePreviewMigrations({ env, inspect, resolveBaseline, logger = console }) {
  if (env.VERCEL_ENV !== "preview") {
    throw new Error("El baseline automático solo está permitido con VERCEL_ENV=preview.");
  }
  if (env[PREVIEW_FLAG]?.trim().toLowerCase() !== "true") {
    throw new Error(`El baseline automático requiere ${PREVIEW_FLAG}=true únicamente en Preview.`);
  }

  let decision;
  try {
    decision = classifyPreviewDatabase(await inspect());
  } catch (error) {
    throw new Error(sanitize(error instanceof Error ? error.message : error, env));
  }

  if (decision.mode === "resolve-baseline") {
    logger.info(`[preview-baseline] Esquema histórico compatible; registrando únicamente ${BASELINE_MIGRATION}.`);
    try {
      await resolveBaseline();
    } catch (error) {
      throw new Error(sanitize(error instanceof Error ? error.message : error, env));
    }
  } else if (decision.mode === "empty") {
    logger.info("[preview-baseline] Base vacía; migrate deploy aplicará baseline e incremental.");
  } else if (decision.mode === "baseline-recorded") {
    logger.info("[preview-baseline] Baseline ya registrado; migrate deploy aplicará las migraciones incrementales pendientes.");
  } else if (decision.mode === "migrations-pending") {
    logger.info("[preview-baseline] Historial válido con migraciones pendientes; migrate deploy completará la secuencia.");
  } else {
    logger.info("[preview-baseline] Todas las migraciones del repositorio ya están registradas; se verificará su estado.");
  }
  return decision;
}

function resolveBaselineMigration(env) {
  const result = spawnSync(
    process.execPath,
    [PRISMA_CLI, "migrate", "resolve", "--applied", BASELINE_MIGRATION],
    { cwd: process.cwd(), env, encoding: "utf8", shell: false, maxBuffer: 10 * 1024 * 1024 },
  );
  const stdout = sanitize(result.stdout, env);
  const stderr = sanitize(result.stderr, env);
  if (stdout) console.log(stdout.trimEnd());
  if (stderr) console.error(stderr.trimEnd());
  if (result.error || result.status !== 0) {
    throw new Error(`migrate resolve del baseline falló con código ${result.status ?? "desconocido"}.`);
  }
}

async function main() {
  const directUrl = process.env[DIRECT_URL]?.trim();
  if (!directUrl) throw new Error(`Falta la variable ${DIRECT_URL}.`);
  await preparePreviewMigrations({
    env: process.env,
    inspect: async () => {
      const prisma = new PrismaClient({ datasourceUrl: directUrl });
      try {
        return await inspectPreviewDatabase(prisma);
      } finally {
        await prisma.$disconnect();
      }
    },
    resolveBaseline: async () => resolveBaselineMigration(process.env),
  });
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(`[preview-baseline] ${sanitize(error instanceof Error ? error.message : error, process.env)}`);
    process.exitCode = 1;
  });
}
