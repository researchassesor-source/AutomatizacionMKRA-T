// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPreflight } from "./preflight";

const NOW = new Date("2026-08-06T15:00:00.000Z");

/** Nombres reales de los índices que garantizan la idempotencia. */
const INDEXES = [
  "outbound_messages_leadId_enrollmentId_sequenceKey_stepKey_key",
  "automation_rules_courseId_channel_planKey_key",
  "social_posts_occurrenceKey_key",
  "enrollments_leadId_courseId_key",
];
const TABLES = ["course_sessions", "automation_rules", "outbound_messages", "social_posts", "enrollments", "leads", "courses"];
const COLUMNS = [
  "courses.streamUrl",
  "course_sessions.startAt",
  "outbound_messages.courseSessionId",
  "automation_rules.requiresStreamUrl",
  "automation_rules.planKey",
  "automation_rules.waTemplateName",
  "outbound_messages.waTemplate",
  "outbound_messages.readAt",
];

/** Registro de cualquier método de escritura que se invoque por error. */
const mutations: string[] = [];
function forbidden(name: string) {
  return vi.fn(async () => {
    mutations.push(name);
    return {};
  });
}

/** Regla de WhatsApp tal como queda guardada, para comparar con el catálogo. */
type ReglaGuardada = { name: string; waTemplateName: string | null; waTemplateLanguage: string | null; waTemplateBodyVars: unknown };

function db(overrides: { tables?: string[]; columns?: string[]; indexes?: string[]; migrationsBroken?: boolean; counts?: Record<string, number>; reglasGuardadas?: ReglaGuardada[] } = {}) {
  const counts = { published: 3, withoutSessions: 0, withoutStream: 0, withActiveRules: 3, pausedRules: 0, stale1h: 0, stale6h: 0, stalePosts: 0, whatsappRules: 0, whatsappWithoutTemplate: 0, whatsappQueued: 0, enrolledWithout: 0, ...overrides.counts };
  let messageCountCall = 0;
  return {
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.includes("information_schema.tables")) return (overrides.tables ?? TABLES).map((t) => ({ t }));
      if (sql.includes("information_schema.columns")) {
        return (overrides.columns ?? COLUMNS).map((column) => {
          const [t, c] = column.split(".");
          return { t, c };
        });
      }
      if (sql.includes("pg_indexes")) return (overrides.indexes ?? INDEXES).map((i) => ({ i }));
      if (sql.includes("_prisma_migrations")) {
        return [{ migration_name: "20260806010000_course_sessions_and_stream_links", finished_at: overrides.migrationsBroken ? null : new Date(), rolled_back_at: null }];
      }
      return [];
    }),
    course: {
      count: vi.fn(async ({ where }: any) => {
        if (where?.sessions?.none && where.startsAt === null) return counts.withoutSessions;
        if (where?.streamUrl === null) return counts.withoutStream;
        if (where?.automationRules) return counts.withActiveRules;
        return counts.published;
      }),
      findMany: vi.fn(async () => []),
      update: forbidden("course.update"),
      updateMany: forbidden("course.updateMany"),
      delete: forbidden("course.delete"),
    },
    lead: { count: vi.fn(async () => 0), update: forbidden("lead.update") },
    enrollment: { count: vi.fn(async () => counts.enrolledWithout), update: forbidden("enrollment.update") },
    courseSession: { count: vi.fn(async () => 0) },
    automationRule: {
      count: vi.fn(async ({ where }: any) => {
        if (where?.channel !== "WHATSAPP") return counts.pausedRules;
        // La consulta de reglas sin plantilla se distingue por su filtro OR.
        return where?.OR ? counts.whatsappWithoutTemplate : counts.whatsappRules;
      }),
      // Reglas de WhatsApp con plantilla guardada, para comparar esa copia con
      // el catalogo del codigo. Por omision no hay ninguna desfasada.
      findMany: vi.fn(async () => overrides.reglasGuardadas ?? []),
      updateMany: forbidden("automationRule.updateMany"),
    },
    outboundMessage: {
      count: vi.fn(async ({ where }: any) => {
        if (where?.channel === "WHATSAPP") return counts.whatsappQueued;
        messageCountCall += 1;
        return messageCountCall === 1 ? counts.stale1h : counts.stale6h;
      }),
      updateMany: forbidden("outboundMessage.updateMany"),
      update: forbidden("outboundMessage.update"),
      create: forbidden("outboundMessage.create"),
    },
    socialPost: {
      count: vi.fn(async () => counts.stalePosts),
      updateMany: forbidden("socialPost.updateMany"),
      create: forbidden("socialPost.create"),
    },
    socialAccount: {
      findMany: vi.fn(async () => [{ platform: "FACEBOOK", displayName: "Research Assessor & Training", externalId: "1190035477534301" }]),
      updateMany: forbidden("socialAccount.updateMany"),
    },
    catalogSyncRun: {
      findFirst: vi.fn(async () => ({ status: "SYNCED", created: 0, updated: 2, conflicts: 0, metadata: { ignored: 3 } })),
      create: forbidden("catalogSyncRun.create"),
    },
  } as any;
}

function healthyEnv() {
  vi.stubEnv("EMAIL_FROM", "avillagomez@ra-training.com");
  vi.stubEnv("SMTP_HOST", "mail.ra-training.com");
  vi.stubEnv("SMTP_USER", "avillagomez@ra-training.com");
  vi.stubEnv("SMTP_PASSWORD", "valor-de-prueba");
  vi.stubEnv("CRON_SECRET", "valor-de-prueba");
  vi.stubEnv("WORDPRESS_COURSES_API_URL", "https://ra-training.com/wp-json/wp/v2/cursos");
  vi.stubEnv("META_SYSTEM_USER_TOKEN", "valor-de-prueba");
  vi.stubEnv("META_PAGE_ID", "1190035477534301");
  vi.stubEnv("META_INSTAGRAM_ACCOUNT_ID", "17841403176483044");
  // WhatsApp completamente configurado, en simulación: es el estado sano por
  // defecto para las pruebas que no van específicamente sobre este canal.
  vi.stubEnv("WHATSAPP_MODE", "simulation");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "valor-de-prueba");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "valor-de-prueba");
  vi.stubEnv("META_APP_SECRET", "valor-de-prueba");
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "valor-de-prueba");
}

beforeEach(() => { mutations.length = 0; });
afterEach(() => vi.unstubAllEnvs());

describe("preflight", () => {
  it("devuelve PASS cuando todo está en orden y en simulación", async () => {
    healthyEnv();
    vi.stubEnv("MESSAGING_MODE", "simulation");
    vi.stubEnv("SOCIAL_MODE", "simulation");
    const report = await runPreflight(db(), NOW);
    // Simulación es un aviso deliberado, no un fallo.
    expect(report.summary.fail).toBe(0);
    expect(report.verdict).toBe("WARN");
  });

  it("devuelve PASS pleno con live y fechas de corte válidas", async () => {
    healthyEnv();
    vi.stubEnv("MESSAGING_MODE", "live");
    vi.stubEnv("MESSAGING_LIVE_FROM", "2026-08-06T18:00:00Z");
    vi.stubEnv("SOCIAL_MODE", "live");
    vi.stubEnv("SOCIAL_LIVE_FROM", "2026-08-06T18:00:00Z");
    const report = await runPreflight(db(), NOW);
    expect(report.verdict).toBe("PASS");
    expect(report.summary.warn).toBe(0);
  });

  it("devuelve FAIL si live no tiene fecha de corte", async () => {
    healthyEnv();
    vi.stubEnv("MESSAGING_MODE", "live");
    const report = await runPreflight(db(), NOW);
    expect(report.verdict).toBe("FAIL");
    expect(report.checks.find((check) => check.id === "messaging_mode")?.level).toBe("FAIL");
  });

  it("devuelve FAIL si falta un índice de idempotencia", async () => {
    healthyEnv();
    const report = await runPreflight(db({ indexes: INDEXES.slice(1) }), NOW);
    const indexes = report.checks.find((check) => check.id === "indexes");
    expect(indexes?.level).toBe("FAIL");
    expect(indexes?.detail).toContain("duplicados");
  });

  it("devuelve FAIL si falta una tabla o columna crítica", async () => {
    healthyEnv();
    expect((await runPreflight(db({ tables: TABLES.slice(1) }), NOW)).checks.find((c) => c.id === "tables")?.level).toBe("FAIL");
    expect((await runPreflight(db({ columns: COLUMNS.slice(1) }), NOW)).checks.find((c) => c.id === "columns")?.level).toBe("FAIL");
  });

  it("devuelve FAIL si hay una migración incompleta", async () => {
    healthyEnv();
    const report = await runPreflight(db({ migrationsBroken: true }), NOW);
    expect(report.checks.find((check) => check.id === "migrations")?.level).toBe("FAIL");
  });

  it("avisa de reglas de WhatsApp activas con el canal deshabilitado", async () => {
    healthyEnv();
    vi.stubEnv("WHATSAPP_MODE", "");
    const report = await runPreflight(db({ counts: { whatsappRules: 4 } }), NOW);
    const whatsapp = report.checks.find((check) => check.id === "whatsapp_rules");
    expect(whatsapp?.level).toBe("WARN");
    expect(whatsapp?.detail).toContain("se acumularán como PROGRAMADO");
  });

  it("avisa de colas estancadas y de inscritos sin mensajes", async () => {
    healthyEnv();
    const report = await runPreflight(db({ counts: { stale6h: 12, stalePosts: 2, enrolledWithout: 5 } }), NOW);
    expect(report.checks.find((check) => check.id === "stale_messages_6h")?.level).toBe("WARN");
    expect(report.checks.find((check) => check.id === "stale_posts_6h")?.level).toBe("WARN");
    expect(report.checks.find((check) => check.id === "enrolled_without_messages")?.level).toBe("WARN");
  });

  it("informa de los placeholders ignorados sin tratarlos como conflicto", async () => {
    healthyEnv();
    const report = await runPreflight(db(), NOW);
    const wordpress = report.checks.find((check) => check.id === "wordpress_run");
    expect(wordpress?.level).toBe("PASS");
    expect(wordpress?.detail).toContain("3 ignorados");
  });

  it("no ejecuta ninguna mutación", async () => {
    healthyEnv();
    await runPreflight(db({ counts: { pausedRules: 60, stale6h: 9, whatsappRules: 2 } }), NOW);
    expect(mutations).toEqual([]);
  });

  it("avisa cuando una regla guarda una versión antigua de su plantilla", async () => {
    healthyEnv();
    // Caso real: la regla se creó cuando el código declaraba tres variables
    // para el aviso de 15 minutos, y en Meta hay cuatro.
    const report = await runPreflight(db({
      reglasGuardadas: [
        { name: "Acceso 15 minutos antes · WhatsApp", waTemplateName: "ra_training_acceso_15min", waTemplateLanguage: "es", waTemplateBodyVars: ["nombre", "curso", "streamUrl"] },
        { name: "Acceso 2 horas antes · WhatsApp", waTemplateName: "ra_training_acceso_2h", waTemplateLanguage: "es", waTemplateBodyVars: ["nombre", "curso", "horaSesion", "streamUrl"] },
      ],
    }), NOW);
    const drift = report.checks.find((check) => check.id === "whatsapp_template_drift");
    expect(drift?.level).toBe("WARN");
    expect(drift?.detail).toContain("ra_training_acceso_15min");
    // La que sí coincide no debe salir señalada.
    expect(drift?.detail).not.toContain("ra_training_acceso_2h");
  });

  it("no señala nada cuando las reglas coinciden con el catálogo", async () => {
    healthyEnv();
    const report = await runPreflight(db({
      reglasGuardadas: [
        { name: "Agradecimiento final · WhatsApp", waTemplateName: "ra_training_agradecimiento_final", waTemplateLanguage: "es", waTemplateBodyVars: ["nombre", "curso"] },
      ],
    }), NOW);
    expect(report.checks.find((check) => check.id === "whatsapp_template_drift")?.level).toBe("PASS");
  });

  it("no expone secretos en el informe", async () => {
    healthyEnv();
    const report = await runPreflight(db(), NOW);
    expect(JSON.stringify(report)).not.toContain("valor-de-prueba");
  });
});
