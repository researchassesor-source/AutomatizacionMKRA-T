import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

export const BASELINE_MIGRATION = "20260728000000_baseline_b1ca4fe";
export const RELEASE_MIGRATION = "20260728010000_crm_release_candidate";

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

const PREVIEW_FLAG = "PREVIEW_DATABASE_MIGRATIONS_ENABLED";
const DIRECT_URL = "POSTGRES_URL_NON_POOLING";
const HISTORY_TABLE = "_prisma_migrations";
const KNOWN_MIGRATIONS = new Set([BASELINE_MIGRATION, RELEASE_MIGRATION]);
const BASELINE_TABLES = Object.keys(BASELINE_TABLE_COLUMNS);
const FINAL_TABLES = new Set([...BASELINE_TABLES, ...INCREMENTAL_TABLES]);
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

function completeFinalSchema(tables, columns) {
  const businessTables = [...tables].filter((table) => table !== HISTORY_TABLE);
  if (!businessTables.every((table) => FINAL_TABLES.has(table))) return false;
  if (![...FINAL_TABLES].every((table) => tables.has(table))) return false;
  const baselineColumnsRemain = Object.entries(BASELINE_TABLE_COLUMNS)
    .every(([table, expected]) => expected.every((column) => columns.has(`${table}.${column}`)));
  return baselineColumnsRemain && INCREMENTAL_REQUIRED_COLUMNS.every((column) => columns.has(column));
}

function migrationState(migrations, name) {
  const row = migrations.find((migration) => migration.name === name);
  if (!row) return "absent";
  return row.applied ? "applied" : "invalid";
}

export function classifyPreviewDatabase(snapshot) {
  const tables = new Set(snapshot.tables);
  const columns = new Set(snapshot.columns);
  const migrations = snapshot.migrations ?? [];
  const unknownMigrations = migrations.filter((migration) => !KNOWN_MIGRATIONS.has(migration.name));
  if (unknownMigrations.length) fail("el historial contiene migraciones desconocidas.");

  const baselineState = migrationState(migrations, BASELINE_MIGRATION);
  const releaseState = migrationState(migrations, RELEASE_MIGRATION);
  if (baselineState === "invalid" || releaseState === "invalid") {
    fail("existe una migración fallida, revertida o incompleta.");
  }
  if (releaseState === "applied" && baselineState !== "applied") {
    fail("la migración incremental figura aplicada sin el baseline.");
  }

  const businessTables = [...tables].filter((table) => table !== HISTORY_TABLE);
  if (businessTables.length === 0) {
    if (baselineState !== "absent" || releaseState !== "absent") {
      fail("el historial no coincide con una base vacía.");
    }
    return { mode: "empty" };
  }

  const baselineCompatible = exactBaselineSchema(tables, columns);
  const finalCompatible = completeFinalSchema(tables, columns);

  if (baselineState === "applied" && releaseState === "applied") {
    if (!finalCompatible) fail("el historial completo no coincide con el esquema final.");
    return { mode: "up-to-date" };
  }

  if (baselineState === "applied") {
    if (!baselineCompatible) fail("el baseline registrado no coincide exactamente con el esquema histórico.");
    return { mode: "baseline-recorded" };
  }

  if (baselineCompatible) return { mode: "resolve-baseline" };
  fail("el esquema es ambiguo, parcial o contiene estructuras incrementales sin historial compatible.");
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
    logger.info("[preview-baseline] Baseline ya registrado; migrate deploy aplicará el incremental pendiente.");
  } else {
    logger.info("[preview-baseline] Baseline e incremental ya registrados; se verificará su estado.");
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
