import { PrismaClient } from "@prisma/client";

/**
 * Diagnóstico de integridad. SOLO LECTURA.
 *
 * No borra, no fusiona y no corrige nada: identifica y cuenta. Cualquier
 * limpieza es una decisión humana que se toma después, registro por registro.
 *
 *   npx tsx --env-file=.env scripts/data-integrity-report.ts
 */
const prisma = new PrismaClient();

function section(title: string) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

async function main() {
  console.log("Diagnóstico de integridad · solo lectura\n");

  section("Duplicados de identidad");
  const duplicateEmails = await prisma.$queryRawUnsafe<Array<{ email: string; total: bigint }>>(
    `SELECT lower("email") AS email, COUNT(*) AS total FROM "leads" WHERE "email" <> '' GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 2 DESC LIMIT 50`,
  );
  const duplicatePhones = await prisma.$queryRawUnsafe<Array<{ phone: string; total: bigint }>>(
    `SELECT "phone", COUNT(*) AS total FROM "leads" WHERE "phone" IS NOT NULL AND "phone" <> '' GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 2 DESC LIMIT 50`,
  );
  console.log(`Correos repetidos entre contactos: ${duplicateEmails.length}`);
  console.log(`Teléfonos repetidos entre contactos: ${duplicatePhones.length}`);
  console.log("  Criterio: correo en minúsculas y teléfono normalizado. La captura pública ya");
  console.log("  serializa por identidad con advisory locks, así que un duplicado indica un");
  console.log("  alta manual anterior a esa protección.");

  section("Restricciones que impiden duplicados");
  const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN (
      'enrollments_leadId_courseId_key',
      'outbound_messages_leadId_enrollmentId_sequenceKey_stepKey_key',
      'automation_rules_courseId_planKey_key',
      'social_posts_occurrenceKey_key',
      'lead_events_idempotencyKey_key'
    )`,
  );
  const present = new Set(indexes.map((row) => row.indexname));
  for (const name of [
    "enrollments_leadId_courseId_key",
    "outbound_messages_leadId_enrollmentId_sequenceKey_stepKey_key",
    "automation_rules_courseId_planKey_key",
    "social_posts_occurrenceKey_key",
    "lead_events_idempotencyKey_key",
  ]) {
    console.log(`  ${present.has(name) ? "PRESENTE" : "AUSENTE "} ${name}`);
  }

  section("Sesiones y reglas");
  const duplicateSessions = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*) AS total FROM (SELECT "courseId", "startAt" FROM "course_sessions" GROUP BY 1,2 HAVING COUNT(*) > 1) AS d`,
  );
  console.log(`Sesiones con misma fecha en el mismo curso: ${Number(duplicateSessions[0]?.total ?? 0)}`);
  console.log("  No es necesariamente un error: un curso puede tener dos bloques a la misma hora.");
  const rulesWithoutPlan = await prisma.automationRule.count({ where: { planKey: null } });
  console.log(`Reglas fuera del plan estándar (creadas a mano): ${rulesWithoutPlan}`);

  section("Estados incoherentes");
  const publishedWithoutId = await prisma.socialPost.count({ where: { status: "PUBLICADO", externalPostId: null } });
  const sentWithoutProvider = await prisma.outboundMessage.count({
    where: { status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO"] }, providerMessageId: null, isSimulation: false },
  });
  const simulatedWithProvider = await prisma.outboundMessage.count({ where: { isSimulation: true, providerMessageId: { not: null } } });
  console.log(`Publicaciones marcadas como publicadas sin id del proveedor: ${publishedWithoutId}`);
  console.log(`Mensajes reales aceptados sin id del proveedor: ${sentWithoutProvider}`);
  console.log(`Mensajes simulados con id del proveedor: ${simulatedWithProvider}`);
  console.log("  Los tres deberían ser 0: significan un registro que afirma algo no verificable.");

  section("Fechas y enlaces");
  const publishedNoSchedule = await prisma.course.count({ where: { isPublished: true, startsAt: null, sessions: { none: {} } } });
  const sessionsEndBeforeStart = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*) AS total FROM "course_sessions" WHERE "endAt" IS NOT NULL AND "endAt" <= "startAt"`,
  );
  const badStreamUrls = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*) AS total FROM "course_sessions" WHERE "streamUrl" IS NOT NULL AND "streamUrl" NOT LIKE 'https://%'`,
  );
  console.log(`Cursos publicados sin fecha ni sesiones: ${publishedNoSchedule}`);
  console.log(`Sesiones cuyo cierre no es posterior al inicio: ${Number(sessionsEndBeforeStart[0]?.total ?? 0)}`);
  console.log(`Enlaces de sesión que no son https: ${Number(badStreamUrls[0]?.total ?? 0)}`);

  section("Registros huérfanos");
  const orphanMessages = await prisma.outboundMessage.count({ where: { enrollmentId: null, sequenceKey: { startsWith: "automation:" } } });
  const messagesWithoutSession = await prisma.outboundMessage.count({
    where: { courseSessionId: null, status: "PROGRAMADO", sequenceKey: { startsWith: "automation:" } },
  });
  console.log(`Mensajes de automatización sin inscripción asociada: ${orphanMessages}`);
  console.log(`Mensajes programados sin sesión asociada: ${messagesWithoutSession}`);
  console.log("  El segundo es normal: bienvenida y agradecimiento son del curso, no de una sesión.");

  section("Qué NO hace este script");
  console.log("  No borra, no fusiona, no corrige y no cancela nada.");
  console.log("  Cualquier limpieza se decide a mano, registro por registro, desde el panel.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo completar el diagnóstico.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
