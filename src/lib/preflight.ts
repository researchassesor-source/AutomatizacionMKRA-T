import type { PrismaClient } from "@prisma/client";
import { describeEmailConfig, resolveEmailConfig } from "@/lib/email/config";
import { parseLiveFrom } from "@/lib/live-activation";
import { describeMetaConfig, resolveMetaConfig } from "@/lib/social/meta-config";
import { describeWhatsAppConfig } from "@/lib/whatsapp/config";
import { canonicalTemplate, parseBodyVars } from "@/lib/whatsapp/templates";

/**
 * Comprobación previa al despliegue. ESTRICTAMENTE DE SOLO LECTURA.
 *
 * Todas las consultas son SELECT o count. No envía, no publica, no actualiza,
 * no cancela, no reclama y no migra. Nunca imprime secretos ni datos
 * personales: solo agregados y nombres de curso.
 */
export type CheckLevel = "PASS" | "WARN" | "FAIL";

export type PreflightCheck = {
  id: string;
  group: string;
  title: string;
  level: CheckLevel;
  detail: string;
};

export type PreflightReport = {
  generatedAt: string;
  checks: PreflightCheck[];
  summary: { pass: number; warn: number; fail: number };
  verdict: CheckLevel;
};

type Db = Pick<PrismaClient, "$queryRawUnsafe" | "course" | "lead" | "enrollment" | "courseSession" | "automationRule" | "outboundMessage" | "socialPost" | "socialAccount" | "catalogSyncRun">;

function check(id: string, group: string, title: string, level: CheckLevel, detail: string): PreflightCheck {
  return { id, group, title, level, detail };
}

/**
 * Estado de WhatsApp. Solo informa de presencia o ausencia: ningún valor de
 * token, secreto ni identificador aparece aquí ni en el informe.
 */
function whatsappEnvironmentChecks(): PreflightCheck[] {
  const wa = describeWhatsAppConfig();
  const credentialsDetail = [
    wa.phoneNumberConfigured ? null : "WHATSAPP_PHONE_NUMBER_ID",
    wa.tokenConfigured ? null : "WHATSAPP_ACCESS_TOKEN",
  ].filter(Boolean);
  const webhookDetail = [
    wa.appSecretConfigured ? null : "META_APP_SECRET",
    wa.verifyTokenConfigured ? null : "META_WEBHOOK_VERIFY_TOKEN",
  ].filter(Boolean);

  return [
    check("whatsapp_mode", "WhatsApp", "Modo del canal",
      wa.mode === "disabled" ? "WARN" : wa.windowState === "blocked" ? "FAIL" : "PASS",
      wa.mode === "disabled"
        ? "WHATSAPP_MODE ausente o no reconocido: el canal está deshabilitado y no envía ni simula. El correo no se ve afectado."
        : wa.windowState === "blocked"
          ? wa.blockedReason ?? "El canal está bloqueado."
          : wa.windowState === "live"
            ? `Envío real desde ${wa.liveFrom}.`
            : "En simulación: no se envía ningún WhatsApp real."),
    check("whatsapp_credentials", "WhatsApp", "Credenciales de envío",
      credentialsDetail.length === 0 ? "PASS" : wa.mode === "live" ? "FAIL" : "WARN",
      credentialsDetail.length === 0
        ? "Número y token presentes (no se muestran)."
        : `Faltan: ${credentialsDetail.join(", ")}.`),
    check("whatsapp_webhook", "WhatsApp", "Webhook de estados",
      webhookDetail.length === 0 ? "PASS" : wa.mode === "live" ? "FAIL" : "WARN",
      webhookDetail.length === 0
        ? "App Secret y verify token presentes: el webhook puede verificarse y firmar."
        : `Faltan: ${webhookDetail.join(", ")}. Sin esto los mensajes se quedan en ACEPTADO y nunca llegan a ENTREGADO ni LEÍDO.`),
  ];
}

async function environmentChecks(): Promise<PreflightCheck[]> {
  const email = describeEmailConfig(resolveEmailConfig());
  const meta = describeMetaConfig(resolveMetaConfig());
  const messagingMode = process.env.MESSAGING_MODE?.trim() ?? "simulation";
  const socialMode = process.env.SOCIAL_MODE?.trim() ?? "simulation";
  const messagingFrom = parseLiveFrom(process.env.MESSAGING_LIVE_FROM);
  const socialFrom = parseLiveFrom(process.env.SOCIAL_LIVE_FROM);

  return [
    check("smtp", "Correo", "Proveedor SMTP", email.provider === "smtp" ? "PASS" : email.provider === "resend" ? "WARN" : "FAIL",
      email.provider === "smtp"
        ? `SMTP configurado (${email.host}:${email.port}), remitente ${email.from}.`
        : email.provider === "resend"
          ? "Se usará el respaldo Resend en lugar del correo institucional."
          : email.reason ?? "Correo saliente sin configurar."),
    check("messaging_mode", "Correo", "Modo de mensajería", messagingMode === "live" ? (messagingFrom ? "PASS" : "FAIL") : "WARN",
      messagingMode === "live"
        ? messagingFrom
          ? `Envío real desde ${messagingFrom.toISOString()}.`
          : "MESSAGING_MODE=live sin MESSAGING_LIVE_FROM válido: el procesador queda bloqueado y no enviará nada."
        : "En simulación: no se envía ningún correo real."),
    check("social_mode", "Redes", "Modo de publicación", socialMode === "live" ? (socialFrom ? "PASS" : "FAIL") : "WARN",
      socialMode === "live"
        ? socialFrom
          ? `Publicación real desde ${socialFrom.toISOString()}.`
          : "SOCIAL_MODE=live sin SOCIAL_LIVE_FROM válido: el publicador queda bloqueado y no publicará nada."
        : "En simulación: no se publica contenido real."),
    check("meta_config", "Redes", "Credenciales de Meta", meta.tokenConfigured && meta.pageId && meta.instagramAccountId ? "PASS" : "WARN",
      meta.tokenConfigured && meta.pageId && meta.instagramAccountId
        ? `Token presente, Graph ${meta.graphVersion}, página y cuenta de Instagram declaradas.`
        : "Faltan token, META_PAGE_ID o META_INSTAGRAM_ACCOUNT_ID."),
    check("cron_secret", "Cron", "Secreto de los procesos programados", process.env.CRON_SECRET?.trim() ? "PASS" : "FAIL",
      process.env.CRON_SECRET?.trim()
        ? "CRON_SECRET presente: los endpoints exigen autenticación."
        : "Sin CRON_SECRET los endpoints de automatización no pueden autenticarse."),
    check("wordpress", "WordPress", "Origen del catálogo", process.env.WORDPRESS_COURSES_API_URL?.trim() ? "PASS" : "WARN",
      process.env.WORDPRESS_COURSES_API_URL?.trim()
        ? "Endpoint del catálogo configurado."
        : "Sin WORDPRESS_COURSES_API_URL la sincronización del catálogo no puede ejecutarse."),
    ...whatsappEnvironmentChecks(),
  ];
}

const CRITICAL_TABLES = ["course_sessions", "automation_rules", "outbound_messages", "social_posts", "enrollments", "leads", "courses"];
const CRITICAL_COLUMNS = [
  "courses.streamUrl",
  "course_sessions.startAt",
  "outbound_messages.courseSessionId",
  "automation_rules.requiresStreamUrl",
  "automation_rules.planKey",
  "automation_rules.waTemplateName",
  "outbound_messages.waTemplate",
  "outbound_messages.readAt",
];
const CRITICAL_INDEXES = [
  "outbound_messages_leadId_enrollmentId_sequenceKey_stepKey_key",
  "automation_rules_courseId_channel_planKey_key",
  "social_posts_occurrenceKey_key",
  "enrollments_leadId_courseId_key",
];

async function schemaChecks(db: Db): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const tables = await db.$queryRawUnsafe<Array<{ t: string }>>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public'",
  );
  const tableNames = new Set(tables.map((row) => row.t));
  const missingTables = CRITICAL_TABLES.filter((name) => !tableNames.has(name));
  checks.push(check("tables", "Base de datos", "Tablas críticas", missingTables.length ? "FAIL" : "PASS",
    missingTables.length ? `Faltan: ${missingTables.join(", ")}.` : `Las ${CRITICAL_TABLES.length} tablas críticas existen.`));

  const columns = await db.$queryRawUnsafe<Array<{ t: string; c: string }>>(
    "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema='public'",
  );
  const columnNames = new Set(columns.map((row) => `${row.t}.${row.c}`));
  const missingColumns = CRITICAL_COLUMNS.filter((name) => !columnNames.has(name));
  checks.push(check("columns", "Base de datos", "Columnas críticas", missingColumns.length ? "FAIL" : "PASS",
    missingColumns.length ? `Faltan: ${missingColumns.join(", ")}.` : "Todas las columnas críticas existen."));

  const indexes = await db.$queryRawUnsafe<Array<{ i: string }>>(
    "SELECT indexname AS i FROM pg_indexes WHERE schemaname='public'",
  );
  const indexNames = new Set(indexes.map((row) => row.i));
  const missingIndexes = CRITICAL_INDEXES.filter((name) => !indexNames.has(name));
  checks.push(check("indexes", "Base de datos", "Índices e restricciones de idempotencia", missingIndexes.length ? "FAIL" : "PASS",
    missingIndexes.length
      ? `Faltan: ${missingIndexes.join(", ")}. Sin ellos no hay garantía contra duplicados.`
      : "Las restricciones únicas que impiden duplicados están presentes."));

  try {
    const migrations = await db.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name',
    );
    const broken = migrations.filter((row) => row.finished_at === null || row.rolled_back_at !== null);
    checks.push(check("migrations", "Base de datos", "Historial de migraciones", broken.length ? "FAIL" : "PASS",
      broken.length
        ? `Hay ${broken.length} migración(es) incompleta(s) o revertida(s).`
        : `${migrations.length} migraciones aplicadas, ninguna fallida. Última: ${migrations.at(-1)?.migration_name ?? "—"}.`));
  } catch {
    checks.push(check("migrations", "Base de datos", "Historial de migraciones", "FAIL",
      "No existe la tabla _prisma_migrations: la base no se creó con migraciones versionadas."));
  }
  return checks;
}

async function catalogChecks(db: Db, now: Date): Promise<PreflightCheck[]> {
  const [published, withoutSessions, withoutStream, withActiveRules, pausedRules] = await Promise.all([
    db.course.count({ where: { isPublished: true } }),
    db.course.count({ where: { isPublished: true, startsAt: null, sessions: { none: {} } } }),
    db.course.count({ where: { isPublished: true, streamUrl: null, sessions: { none: { streamUrl: { not: null } } } } }),
    db.course.count({ where: { isPublished: true, automationRules: { some: { status: "ACTIVE" } } } }),
    db.automationRule.count({ where: { status: "PAUSED" } }),
  ]);
  const lastRun = await db.catalogSyncRun.findFirst({ where: { source: "wordpress" }, orderBy: { startedAt: "desc" } });
  const metadata = (lastRun?.metadata ?? {}) as { ignored?: number; conflictItems?: unknown[] };

  return [
    check("courses_published", "Catálogo", "Cursos publicados", published > 0 ? "PASS" : "WARN",
      `${published} curso(s) publicados.`),
    check("courses_without_schedule", "Catálogo", "Cursos sin fecha ni sesiones", withoutSessions > 0 ? "WARN" : "PASS",
      withoutSessions > 0
        ? `${withoutSessions} curso(s) publicados no tienen fecha ni sesiones: sus recordatorios no se programan.`
        : "Todos los cursos publicados tienen calendario."),
    check("courses_without_stream", "Catálogo", "Cursos sin enlace de transmisión", withoutStream > 0 ? "WARN" : "PASS",
      withoutStream > 0
        ? `${withoutStream} curso(s) publicados no tienen enlace: el recordatorio de 15 minutos quedará omitido.`
        : "Todos los cursos publicados tienen enlace de transmisión."),
    check("courses_with_rules", "Catálogo", "Cursos con automatizaciones activas", withActiveRules > 0 ? "PASS" : "WARN",
      `${withActiveRules} de ${published} curso(s) publicados tienen al menos una automatización activa.`),
    check("paused_rules", "Automatizaciones", "Reglas pausadas", pausedRules > 0 ? "WARN" : "PASS",
      pausedRules > 0
        ? `${pausedRules} regla(s) pausadas. Revisa el desglose por curso y motivo en /admin/automatizaciones.`
        : "No hay automatizaciones pausadas."),
    check("wordpress_run", "WordPress", "Última sincronización", lastRun ? (lastRun.status === "ERROR" ? "FAIL" : lastRun.conflicts > 0 ? "WARN" : "PASS") : "WARN",
      lastRun
        ? `Estado ${lastRun.status}: ${lastRun.created} nuevos, ${lastRun.updated} actualizados, ${lastRun.conflicts} conflictos reales, ${metadata.ignored ?? 0} ignorados (páginas genéricas).`
        : "Todavía no se ha ejecutado ninguna sincronización del catálogo."),
    check("stale_messages", "Correo", "Mensajes atrasados", "PASS",
      `${await db.outboundMessage.count({ where: { status: "PROGRAMADO", scheduledAt: { lt: new Date(now.getTime() - 60 * 60_000) } } })} mensaje(s) programados con más de una hora de retraso.`),
  ];
}

async function operationalChecks(db: Db, now: Date): Promise<PreflightCheck[]> {
  const [staleMessages, stalePosts, whatsappRules, activeAccounts, enrolledWithoutMessages, whatsappRulesWithoutTemplate, whatsappQueued, whatsappRulesWithStoredTemplate] = await Promise.all([
    db.outboundMessage.count({ where: { status: "PROGRAMADO", scheduledAt: { lt: new Date(now.getTime() - 6 * 60 * 60_000) } } }),
    db.socialPost.count({ where: { status: "PROGRAMADO", scheduledAt: { lt: new Date(now.getTime() - 6 * 60 * 60_000) } } }),
    db.automationRule.count({ where: { status: "ACTIVE", channel: "WHATSAPP" } }),
    db.socialAccount.findMany({ where: { isActive: true }, select: { platform: true, displayName: true, externalId: true } }),
    db.enrollment.count({
      where: {
        status: { notIn: ["CANCELADO"] },
        lead: { classification: "REAL", consent: true },
        course: { isPublished: true, automationRules: { some: { status: "ACTIVE" } } },
        messages: { none: {} },
      },
    }),
    db.automationRule.count({
      where: { channel: "WHATSAPP", status: { in: ["ACTIVE", "PAUSED"] }, OR: [{ waTemplateName: null }, { waTemplateName: "" }] },
    }),
    db.outboundMessage.count({ where: { channel: "WHATSAPP", status: "PROGRAMADO" } }),
    db.automationRule.findMany({
      where: { channel: "WHATSAPP", status: { in: ["ACTIVE", "PAUSED"] }, NOT: { waTemplateName: null } },
      select: { name: true, waTemplateName: true, waTemplateLanguage: true, waTemplateBodyVars: true },
    }),
  ]);
  const legacyAccounts = activeAccounts.filter((account) => !account.externalId);
  const whatsappDisabled = describeWhatsAppConfig().mode === "disabled";

  /**
   * Reglas cuya copia guardada de la plantilla ya no coincide con el catalogo.
   *
   * No es una averia: al enviar manda el catalogo, justamente para que un
   * desfase asi no acabe en un rechazo de Meta. Pero si conviene verlo, porque
   * significa que la fila quedo vieja y quien lea la regla en la base leera
   * algo que no es lo que se envia. Se arregla reaplicando el plan.
   */
  const desfasadas = whatsappRulesWithStoredTemplate.filter((rule) => {
    const canonical = rule.waTemplateName ? canonicalTemplate(rule.waTemplateName) : null;
    if (!canonical) return false;
    const guardadas = parseBodyVars(rule.waTemplateBodyVars);
    return guardadas.length !== canonical.bodyVars.length
      || guardadas.some((variable, index) => variable !== canonical.bodyVars[index])
      || (rule.waTemplateLanguage ?? "es") !== canonical.language;
  });

  return [
    check("stale_messages_6h", "Cron", "Cola de correo estancada", staleMessages > 0 ? "WARN" : "PASS",
      staleMessages > 0
        ? `${staleMessages} mensaje(s) llevan más de 6 horas vencidos: probable señal de que el reloj automático no está corriendo.`
        : "No hay mensajes vencidos sin procesar."),
    check("stale_posts_6h", "Cron", "Cola de publicaciones estancada", stalePosts > 0 ? "WARN" : "PASS",
      stalePosts > 0 ? `${stalePosts} publicación(es) llevan más de 6 horas vencidas.` : "No hay publicaciones vencidas sin procesar."),
    check("whatsapp_rules", "WhatsApp", "Reglas activas con el canal apagado", whatsappRules > 0 && whatsappDisabled ? "WARN" : "PASS",
      whatsappRules > 0 && whatsappDisabled
        ? `${whatsappRules} regla(s) de WhatsApp están activas pero WHATSAPP_MODE está deshabilitado: sus mensajes se acumularán como PROGRAMADO sin salir.`
        : `${whatsappRules} regla(s) de WhatsApp activas.`),
    check("whatsapp_templates", "WhatsApp", "Reglas sin plantilla asignada", whatsappRulesWithoutTemplate > 0 ? "WARN" : "PASS",
      whatsappRulesWithoutTemplate > 0
        ? `${whatsappRulesWithoutTemplate} regla(s) de WhatsApp no declaran plantilla aprobada. Sus mensajes se registran como OMITIDO en lugar de enviarse como texto libre, que Meta rechazaría.`
        : "Todas las reglas de WhatsApp declaran su plantilla."),
    check("whatsapp_template_drift", "WhatsApp", "Reglas con la plantilla desfasada", desfasadas.length > 0 ? "WARN" : "PASS",
      desfasadas.length > 0
        ? `${desfasadas.length} regla(s) guardan una versión antigua de su plantilla (${[...new Set(desfasadas.map((rule) => rule.waTemplateName))].join(", ")}). El envío usa el catálogo del código, así que no falla, pero conviene reaplicar el plan para que la base coincida.`
        : "Las reglas guardan la misma plantilla que declara el código."),
    check("whatsapp_queue", "WhatsApp", "Cola de WhatsApp", whatsappQueued > 0 && whatsappDisabled ? "WARN" : "PASS",
      whatsappQueued > 0 && whatsappDisabled
        ? `${whatsappQueued} mensaje(s) de WhatsApp esperan con el canal deshabilitado. Al activarlo saldrán solo los posteriores a WHATSAPP_LIVE_FROM.`
        : `${whatsappQueued} mensaje(s) de WhatsApp en cola.`),
    check("social_accounts", "Redes", "Cuentas sociales activas", activeAccounts.length > 0 ? "PASS" : "WARN",
      activeAccounts.length > 0
        ? `Activas: ${activeAccounts.map((account) => `${account.platform}/${account.displayName}`).join(", ")}.`
        : "No hay cuentas sociales activas."),
    check("legacy_accounts", "Redes", "Cuentas antiguas activas", legacyAccounts.length > 0 ? "WARN" : "PASS",
      legacyAccounts.length > 0
        ? `${legacyAccounts.length} cuenta(s) activas sin identificador externo: probablemente registros antiguos que deberían desactivarse.`
        : "Todas las cuentas activas tienen identificador del proveedor."),
    check("enrolled_without_messages", "Correo", "Inscritos sin mensajes", enrolledWithoutMessages > 0 ? "WARN" : "PASS",
      enrolledWithoutMessages > 0
        ? `${enrolledWithoutMessages} inscripción(es) de cursos con reglas activas no tienen ningún mensaje: reprograma el curso o aplica el plan estándar.`
        : "Todas las inscripciones elegibles tienen mensajes programados."),
  ];
}

/**
 * Un bloque que falla no puede tumbar el informe: precisamente cuando la base
 * está incompleta es cuando más hace falta leer el resto del diagnóstico.
 */
async function safely(group: string, id: string, run: () => Promise<PreflightCheck[]>): Promise<PreflightCheck[]> {
  try {
    return await run();
  } catch (error) {
    // Los errores de Prisma empiezan con líneas vacías: se toma la primera útil.
    const message = error instanceof Error
      ? (error.message.split("\n").map((line) => line.trim()).find(Boolean) ?? "error desconocido")
      : "error desconocido";
    return [check(id, group, "Comprobación no ejecutable", "FAIL",
      `No se pudo completar: ${message}. Suele indicar que faltan migraciones por aplicar en esta base.`)];
  }
}

export async function runPreflight(db: Db, now = new Date()): Promise<PreflightReport> {
  const checks = [
    ...(await safely("Entorno", "environment_block", environmentChecks)),
    ...(await safely("Base de datos", "schema_block", () => schemaChecks(db))),
    ...(await safely("Catálogo", "catalog_block", () => catalogChecks(db, now))),
    ...(await safely("Operación", "operational_block", () => operationalChecks(db, now))),
  ];
  const summary = {
    pass: checks.filter((item) => item.level === "PASS").length,
    warn: checks.filter((item) => item.level === "WARN").length,
    fail: checks.filter((item) => item.level === "FAIL").length,
  };
  return {
    generatedAt: now.toISOString(),
    checks,
    summary,
    verdict: summary.fail > 0 ? "FAIL" : summary.warn > 0 ? "WARN" : "PASS",
  };
}
