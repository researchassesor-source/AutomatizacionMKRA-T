import { z } from "zod";
import { automationRuleCanRun } from "@/lib/automation-eligibility";
import { courseAutomationWindow } from "@/lib/course-automation-window";
import { writeAudit } from "@/lib/audit";
import type { AdminSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { quarantineRecoverableMessages } from "@/lib/nurture/queue-safety";

const SOURCE = "wordpress";
const RUN_LOCK_TIMEOUT_MINUTES = 15;

export const WORDPRESS_CRM_SLUG_BY_ID = {
  "2231": "ia-apoyo-tareas-estudiantiles",
  "2235": "ia-planificacion-educativa",
  "2237": "ia-planificacion-recursos-educativos",
  "2287": "comunicacion-estrategica-digital",
  "2288": "procedimientos-parlamentarios",
  "2289": "mecanismos-de-participacion-ciudadana-y-control-social",
  "2292": "habilidades-blandas-profesionales",
  "2294": "redaccion-elaboracion-oficios",
  "2239": "ia-generativa-claude-basico",
} as const satisfies Record<string, string>;

const wordpressCourseSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
  slug: z.string().min(1).max(300),
  link: z.string().url(),
  modified_gmt: z.string().optional(),
  modified: z.string().optional(),
  status: z.string().min(1).max(40).default("publish"),
  title: z.union([z.string(), z.object({ rendered: z.string() })]),
  acf: z.union([z.record(z.unknown()), z.array(z.unknown())]).optional(),
});

export type WordPressCourse = {
  externalId: string;
  officialSlug: string;
  officialUrl: string;
  title: string;
  crmSlug: string | null;
  sourceUpdatedAt: Date | null;
  sourceStatus: string;
};

export type CourseIdentity = {
  id: string;
  slug: string;
  crmSlug: string | null;
  externalId: string | null;
  externalSource: string | null;
};

export type WordPressMappingDecision =
  | { kind: "link"; courseId: string; crmSlug: string }
  | { kind: "create"; crmSlug: string }
  | { kind: "ignore"; reason: string }
  | { kind: "conflict"; reason: string; courseId?: string };

type ConflictItem = {
  externalId: string;
  officialSlug: string;
  title: string;
  reason: string;
};

type IgnoredItem = ConflictItem & { explanation: string };

/** Desglose de cada regla pausada por la sincronización, con su motivo. */
export type PausedRuleDetail = {
  ruleId: string;
  ruleName: string;
  channel: string;
  trigger: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  externalId: string | null;
  isPublished: boolean;
  acceptsRegistrations: boolean;
  reason: string;
};

export const IGNORED_PLACEHOLDER = "IGNORED_PLACEHOLDER";
export const IGNORED_PLACEHOLDER_EXPLANATION = "Página genérica de WordPress; no representa un curso.";

function plainTitle(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isSafeCrmSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** Minúsculas y sin acentos, para comparar títulos de forma exacta. */
function normalizedTitle(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Páginas genéricas «Próximamente» del sitio: no son cursos.
 *
 * La coincidencia es exacta a propósito. Un curso real cuyo título contenga la
 * palabra («Marketing: próximamente nuevas fechas») no debe ignorarse, así que
 * no se admiten coincidencias parciales.
 */
export function isPlaceholderWordPressCourse(course: Pick<WordPressCourse, "officialSlug" | "title">) {
  return /^proximamente(?:-\d+)?$/i.test(course.officialSlug.trim())
    || normalizedTitle(course.title) === "proximamente";
}

function courseBySlug(courses: CourseIdentity[], slug: string) {
  return courses.filter((course) => course.slug === slug || course.crmSlug === slug);
}

function decideTargetCourse(courses: CourseIdentity[], crmSlug: string): WordPressMappingDecision {
  const candidates = courseBySlug(courses, crmSlug);
  if (candidates.length > 1) return { kind: "conflict", reason: "CRM_SLUG_AMBIGUOUS" };
  const candidate = candidates[0];
  if (!candidate) return { kind: "create", crmSlug };
  if (candidate.externalSource && candidate.externalSource !== SOURCE) {
    return { kind: "conflict", reason: "COURSE_LINKED_TO_ANOTHER_SOURCE", courseId: candidate.id };
  }
  return { kind: "link", courseId: candidate.id, crmSlug };
}

export function resolveWordPressCourseMapping(
  source: WordPressCourse,
  courses: CourseIdentity[],
): WordPressMappingDecision {
  // Se descarta antes que nada: una página genérica no crea, no actualiza y no
  // se vincula a ningún curso, ni siquiera si una sincronización anterior llegó
  // a enlazarla.
  if (isPlaceholderWordPressCourse(source)) return { kind: "ignore", reason: IGNORED_PLACEHOLDER };

  const linked = courses.find((course) => course.externalSource === SOURCE && course.externalId === source.externalId);
  if (linked) return { kind: "link", courseId: linked.id, crmSlug: linked.crmSlug ?? linked.slug };

  const explicitSlug = WORDPRESS_CRM_SLUG_BY_ID[source.externalId as keyof typeof WORDPRESS_CRM_SLUG_BY_ID];
  if (explicitSlug) return decideTargetCourse(courses, explicitSlug);
  if (source.crmSlug) {
    if (!isSafeCrmSlug(source.crmSlug)) return { kind: "conflict", reason: "INVALID_EXPLICIT_CRM_SLUG" };
    return decideTargetCourse(courses, source.crmSlug);
  }

  const exact = courseBySlug(courses, source.officialSlug);
  if (exact.length === 1) {
    const candidate = exact[0];
    if (candidate.externalSource && candidate.externalSource !== SOURCE) {
      return { kind: "conflict", reason: "COURSE_LINKED_TO_ANOTHER_SOURCE", courseId: candidate.id };
    }
    return { kind: "link", courseId: candidate.id, crmSlug: candidate.crmSlug ?? candidate.slug };
  }
  if (exact.length > 1) return { kind: "conflict", reason: "OFFICIAL_SLUG_AMBIGUOUS" };
  if (!isSafeCrmSlug(source.officialSlug)) return { kind: "conflict", reason: "INVALID_OFFICIAL_SLUG" };
  return { kind: "create", crmSlug: source.officialSlug };
}

export function normalizeWordPressCourse(input: unknown): WordPressCourse {
  const parsed = wordpressCourseSchema.parse(input);
  const renderedTitle = typeof parsed.title === "string" ? parsed.title : parsed.title.rendered;
  const crmSlug = parsed.acf && !Array.isArray(parsed.acf) && typeof parsed.acf.crm_slug === "string" && parsed.acf.crm_slug.trim()
    ? parsed.acf.crm_slug.trim()
    : null;
  const modified = parsed.modified_gmt ?? parsed.modified;
  const sourceUpdatedAt = modified && !Number.isNaN(new Date(`${modified}${modified.endsWith("Z") ? "" : "Z"}`).getTime())
    ? new Date(`${modified}${modified.endsWith("Z") ? "" : "Z"}`)
    : null;
  return {
    externalId: String(parsed.id),
    officialSlug: parsed.slug,
    officialUrl: parsed.link,
    title: plainTitle(renderedTitle),
    crmSlug,
    sourceUpdatedAt,
    sourceStatus: parsed.status,
  };
}

export function wordpressCatalogConfigured() {
  return Boolean(process.env.WORDPRESS_COURSES_API_URL?.trim());
}

export function safeWordPressErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^WORDPRESS_[A-Z0-9_]+$/.test(message) ? message : "WORDPRESS_SYNC_FAILED";
}

export async function fetchWordPressCourses(fetcher: typeof fetch = fetch): Promise<WordPressCourse[]> {
  const configured = process.env.WORDPRESS_COURSES_API_URL?.trim();
  if (!configured) throw new Error("WORDPRESS_API_URL_MISSING");
  const endpoint = new URL(configured);
  if (endpoint.protocol !== "https:") throw new Error("WORDPRESS_API_REQUIRES_HTTPS");
  if (endpoint.hostname !== "ra-training.com" || endpoint.pathname !== "/wp-json/wp/v2/cursos") {
    throw new Error("WORDPRESS_API_ENDPOINT_NOT_ALLOWED");
  }
  const user = process.env.WORDPRESS_API_USER?.trim();
  const password = process.env.WORDPRESS_API_APP_PASSWORD?.trim();
  if (Boolean(user) !== Boolean(password)) throw new Error("WORDPRESS_API_CREDENTIALS_INCOMPLETE");
  const headers: HeadersInit = { Accept: "application/json" };
  if (user && password) headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  const courses: WordPressCourse[] = [];
  let totalPages = 1;
  /**
   * Total declarado por WordPress (cabecera X-WP-Total), no la cuenta de
   * paginas. Una respuesta 200 parcial (una pagina que fallo entre medias, un
   * proxy que corto la lista) puede dejar `errors = 0` con menos cursos de los
   * que en realidad existen, y reconcileCatalogAndAutomations trataria a los
   * que faltan como si ya no existieran en el sitio. Verificar que la cuenta
   * final coincide con lo que el propio WordPress declaro es lo unico que
   * distingue "esto es todo el catalogo" de "esto es lo que llego".
   */
  let expectedTotal: number | null = null;
  for (let page = 1; page <= Math.min(totalPages, 20); page++) {
    endpoint.searchParams.set("per_page", "100");
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("_fields", "id,slug,link,modified_gmt,modified,status,title,acf");
    const response = await fetcher(endpoint, { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`WORDPRESS_API_HTTP_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("WORDPRESS_API_INVALID_RESPONSE");
    courses.push(...payload.map(normalizeWordPressCourse));
    totalPages = Math.max(1, Number(response.headers.get("x-wp-totalpages")) || 1);

    const totalHeader = response.headers.get("x-wp-total");
    const total = totalHeader === null ? Number.NaN : Number(totalHeader);
    // Ausente, no numerico, negativo o distinto entre paginas: no hay forma
    // segura de saber si el catalogo llego completo, asi que no se asume nada.
    if (!Number.isInteger(total) || total < 0) throw new Error("WORDPRESS_API_INCOMPLETE_CATALOG");
    if (expectedTotal === null) expectedTotal = total;
    else if (expectedTotal !== total) throw new Error("WORDPRESS_API_INCOMPLETE_CATALOG");
  }
  if (expectedTotal === null) throw new Error("WORDPRESS_API_INCOMPLETE_CATALOG");
  // Un total de cero NO significa "borrar/historizar todo": es indistinguible
  // de una fuente rota o mal configurada, y las consecuencias de equivocarse
  // son demasiado grandes para adivinar.
  if (expectedTotal === 0) throw new Error("WORDPRESS_API_EMPTY_CATALOG");
  if (courses.length !== expectedTotal) throw new Error("WORDPRESS_API_INCOMPLETE_CATALOG");

  const ids = new Set<string>();
  for (const course of courses) {
    if (ids.has(course.externalId)) throw new Error("WORDPRESS_API_DUPLICATE_EXTERNAL_ID");
    ids.add(course.externalId);
  }
  return courses;
}

function sameDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

async function synchronizeSourceCourse(source: WordPressCourse, syncedAt: Date) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(68294113)::text AS lock_result`;
    const courses = await tx.course.findMany({
      select: { id: true, slug: true, crmSlug: true, externalId: true, externalSource: true },
    });
    const decision = resolveWordPressCourseMapping(source, courses);
    if (decision.kind === "ignore") {
      // Si una sincronización anterior llegó a enlazar esta página con un curso,
      // se devuelve su id para que el curso NO se marque como histórico ni se
      // pausen sus reglas: ignorar la página no puede tener efectos colaterales.
      const linked = courses.find((course) => course.externalSource === SOURCE && course.externalId === source.externalId);
      return { outcome: "ignored" as const, courseId: linked?.id, reason: decision.reason };
    }
    if (decision.kind === "conflict") {
      if (decision.courseId) {
        await tx.course.update({
          where: { id: decision.courseId },
          data: { syncStatus: "CONFLICT", syncError: decision.reason, lastSyncedAt: syncedAt },
        });
      }
      return { outcome: "conflict" as const, courseId: decision.courseId, reason: decision.reason };
    }

    if (decision.kind === "create") {
      const created = await tx.course.create({
        data: {
          slug: decision.crmSlug,
          crmSlug: decision.crmSlug,
          title: source.title,
          officialCourseUrl: source.officialUrl,
          officialUrl: source.officialUrl,
          officialSlug: source.officialSlug,
          externalSource: SOURCE,
          externalId: source.externalId,
          sourceUpdatedAt: source.sourceUpdatedAt,
          lastSyncedAt: syncedAt,
          syncStatus: "SYNCED",
          syncError: null,
          isPublished: source.sourceStatus === "publish",
          acceptsRegistrations: false,
        },
      });
      return { outcome: "created" as const, courseId: created.id };
    }

    const existing = await tx.course.findUniqueOrThrow({ where: { id: decision.courseId } });
    if (existing.externalSource === SOURCE && existing.externalId && existing.externalId !== source.externalId) {
      await tx.course.update({
        where: { id: existing.id },
        data: { syncStatus: "CONFLICT", syncError: "COURSE_ALREADY_LINKED_TO_ANOTHER_WORDPRESS_ID", lastSyncedAt: syncedAt },
      });
      return { outcome: "conflict" as const, courseId: existing.id, reason: "COURSE_ALREADY_LINKED_TO_ANOTHER_WORDPRESS_ID" };
    }
    const expectedSourceUpdatedAt = source.sourceUpdatedAt ?? existing.sourceUpdatedAt;
    const changed = existing.title !== source.title
      || existing.officialCourseUrl !== source.officialUrl
      || existing.officialUrl !== source.officialUrl
      || existing.officialSlug !== source.officialSlug
      || existing.externalSource !== SOURCE
      || existing.externalId !== source.externalId
      || existing.crmSlug !== decision.crmSlug
      || !sameDate(existing.sourceUpdatedAt, expectedSourceUpdatedAt)
      || existing.isPublished !== (source.sourceStatus === "publish")
      || existing.syncStatus !== "SYNCED"
      || existing.syncError !== null;
    await tx.course.update({
      where: { id: existing.id },
      data: {
        title: source.title,
        officialCourseUrl: source.officialUrl,
        officialUrl: source.officialUrl,
        officialSlug: source.officialSlug,
        externalSource: SOURCE,
        externalId: source.externalId,
        crmSlug: decision.crmSlug,
        sourceUpdatedAt: expectedSourceUpdatedAt,
        lastSyncedAt: syncedAt,
        syncStatus: "SYNCED",
        syncError: null,
        isPublished: source.sourceStatus === "publish",
      },
    });
    return { outcome: changed ? "updated" as const : "unchanged" as const, courseId: existing.id };
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 20_000 });
}

/**
 * Un curso solo puede volverse historico automaticamente por ESTA
 * sincronizacion si de verdad pertenece a esta fuente: sin esto, cualquier
 * curso manual, interno o de otra fuente que simplemente no aparece en la
 * respuesta de WordPress (porque nunca debia aparecer) se marcaria como si
 * hubiera desaparecido del sitio.
 */
function isWordPressManagedCourse(course: { externalSource: string | null; externalId: string | null }) {
  return course.externalSource === SOURCE && Boolean(course.externalId);
}

async function reconcileCatalogAndAutomations(currentCourseIds: Set<string>, conflictCourseIds: Set<string>, syncedAt: Date) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(68294113)::text AS lock_result`;
    const courses = await tx.course.findMany({
      select: {
        id: true,
        title: true,
        slug: true,
        isPublished: true,
        acceptsRegistrations: true,
        startsAt: true,
        endsAt: true,
        externalSource: true,
        externalId: true,
      },
    });
    const historicalCourses = courses.filter((course) => isWordPressManagedCourse(course) && !currentCourseIds.has(course.id));
    for (const course of historicalCourses) {
      await tx.course.update({
        where: { id: course.id },
        data: {
          isPublished: false,
          acceptsRegistrations: false,
          lastSyncedAt: syncedAt,
          syncStatus: conflictCourseIds.has(course.id) ? "CONFLICT" : "HISTORICAL",
          syncError: conflictCourseIds.has(course.id) ? undefined : null,
        },
      });
    }

    const activeRules = await tx.automationRule.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        trigger: true,
        channel: true,
        subject: true,
        body: true,
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            externalId: true,
            externalSource: true,
            isPublished: true,
            acceptsRegistrations: true,
            startsAt: true,
            endsAt: true,
            // Sin las sesiones, un curso cuyas fechas viven solo en
            // `course_sessions` parece no tener calendario y sus recordatorios
            // se pausarían por error.
            sessions: { select: { id: true, title: true, startAt: true, endAt: true, streamUrl: true }, orderBy: { startAt: "asc" } },
          },
        },
      },
    });
    const pausedDetails: PausedRuleDetail[] = activeRules.flatMap((rule) => {
      const isHistorical = isWordPressManagedCourse(rule.course) && !currentCourseIds.has(rule.course.id);
      const window = courseAutomationWindow(rule.course, rule.course.sessions);
      const courseState = {
        isPublished: isHistorical ? false : rule.course.isPublished,
        acceptsRegistrations: isHistorical ? false : rule.course.acceptsRegistrations,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      };
      if (automationRuleCanRun(courseState, rule)) return [];
      const reason = isHistorical
        ? "COURSE_HISTORICAL"
        : !rule.course.isPublished
          ? "COURSE_UNPUBLISHED"
          : rule.trigger === "BEFORE_COURSE" && !window.startsAt
            ? "COURSE_WITHOUT_SCHEDULE"
            : rule.trigger === "AFTER_COURSE" && !window.endsAt
              ? "COURSE_WITHOUT_SCHEDULE"
              : "RULE_TEMPLATE_INVALID";
      return [{
        ruleId: rule.id,
        ruleName: rule.name,
        channel: rule.channel,
        trigger: rule.trigger,
        courseId: rule.course.id,
        courseTitle: rule.course.title,
        courseSlug: rule.course.slug,
        externalId: rule.course.externalId,
        isPublished: rule.course.isPublished,
        acceptsRegistrations: rule.course.acceptsRegistrations,
        reason,
      }];
    });
    const pauseRuleIds = pausedDetails.map((detail) => detail.ruleId);
    if (pauseRuleIds.length) {
      await tx.automationRule.updateMany({
        where: { id: { in: pauseRuleIds } },
        data: { status: "PAUSED", nextExecutionAt: null },
      });
      // La regla queda PAUSED (no ARCHIVED): es reversible por diseño, así que
      // sus mensajes van a OMITIDO, no a CANCELADO. De lo contrario, si un
      // administrador reactivara la regla a mano después de que el curso
      // volviera a estar vigente, rescheduleCourseAutomations no podría
      // recuperar nada -- CANCELADO no es reprogramable.
      await quarantineRecoverableMessages(
        tx,
        { automationRuleId: { in: pauseRuleIds } },
        { errorCode: "COURSE_NOT_ELIGIBLE", errorMessage: "La automatización se pausó porque el curso no está vigente o no tiene fecha o plantilla válida." },
      );
      // Deja rastro por regla y motivo: sin esto no se puede distinguir después
      // una pausa correcta de una provocada por un error de la sincronización.
      await tx.auditLog.create({
        data: {
          actorEmail: "wordpress-sync",
          action: "AUTOMATION_RULES_PAUSED_BY_SYNC",
          entityType: "AutomationRule",
          result: "SUCCESS",
          metadata: { syncedAt: syncedAt.toISOString(), paused: pausedDetails },
        },
      });
    }

    const currentCourses = await tx.course.findMany({
      where: { id: { in: [...currentCourseIds] } },
      select: { id: true, isPublished: true, acceptsRegistrations: true },
    });
    const [activeRuleCount, pausedRuleCount] = await Promise.all([
      tx.automationRule.count({ where: { status: "ACTIVE" } }),
      tx.automationRule.count({ where: { status: "PAUSED" } }),
    ]);
    return {
      current: currentCourses.length,
      open: currentCourses.filter((course) => course.isPublished && course.acceptsRegistrations).length,
      closed: currentCourses.filter((course) => !course.isPublished || !course.acceptsRegistrations).length,
      historical: historicalCourses.length,
      historicalCourses: historicalCourses.map((course) => ({ id: course.id, slug: course.slug, title: course.title })),
      activeRules: activeRuleCount,
      pausedRules: pausedRuleCount,
      rulesPausedThisRun: pauseRuleIds.length,
      // Desglose por curso y motivo para poder consultarlo desde la interfaz.
      pausedThisRunDetails: pausedDetails,
    };
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 });
}

export async function synchronizeWordPressCatalog(session: AdminSession, fetcher: typeof fetch = fetch) {
  const runningSince = new Date(Date.now() - RUN_LOCK_TIMEOUT_MINUTES * 60_000);
  const running = await prisma.catalogSyncRun.findFirst({
    where: { source: SOURCE, completedAt: null, startedAt: { gte: runningSince } },
    select: { id: true },
  });
  if (running) throw new Error("WORDPRESS_SYNC_ALREADY_RUNNING");
  const run = await prisma.catalogSyncRun.create({ data: { source: SOURCE } });
  try {
    const sourceCourses = await fetchWordPressCourses(fetcher);
    const syncedAt = new Date();
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let conflicts = 0;
    let ignored = 0;
    let errors = 0;
    // IDs (no solo el conteo) de lo creado en ESTA vuelta: el orquestador de
    // sync los necesita para distinguir "curso nuevo" de "cambio de fecha" en
    // el mismo barrido, sin adivinar por createdAt.
    const createdCourseIds: string[] = [];
    const currentCourseIds = new Set<string>();
    const conflictCourseIds = new Set<string>();
    const conflictItems: ConflictItem[] = [];
    const ignoredItems: IgnoredItem[] = [];
    const errorItems: Array<{ externalId: string; code: string }> = [];

    for (const source of sourceCourses) {
      try {
        const result = await synchronizeSourceCourse(source, syncedAt);
        if (result.outcome === "created") { created++; createdCourseIds.push(result.courseId); }
        if (result.outcome === "updated") updated++;
        if (result.outcome === "unchanged") unchanged++;
        if (result.outcome === "ignored") {
          ignored++;
          ignoredItems.push({
            externalId: source.externalId,
            officialSlug: source.officialSlug,
            title: source.title,
            reason: result.reason,
            explanation: IGNORED_PLACEHOLDER_EXPLANATION,
          });
          // Un curso enlazado por error a esta página no debe volverse histórico.
          if (result.courseId) currentCourseIds.add(result.courseId);
        } else if (result.outcome === "conflict") {
          conflicts++;
          if (result.courseId) conflictCourseIds.add(result.courseId);
          conflictItems.push({ externalId: source.externalId, officialSlug: source.officialSlug, title: source.title, reason: result.reason });
        } else {
          currentCourseIds.add(result.courseId);
        }
      } catch (error) {
        errors++;
        errorItems.push({ externalId: source.externalId, code: safeWordPressErrorCode(error) });
      }
    }

    const reconciliation = errors === 0
      ? await reconcileCatalogAndAutomations(currentCourseIds, conflictCourseIds, syncedAt)
      : {
        current: currentCourseIds.size,
        open: 0,
        closed: 0,
        historical: 0,
        historicalCourses: [],
        activeRules: await prisma.automationRule.count({ where: { status: "ACTIVE" } }),
        pausedRules: await prisma.automationRule.count({ where: { status: "PAUSED" } }),
        rulesPausedThisRun: 0,
        pausedThisRunDetails: [] as PausedRuleDetail[],
      };
    // Los ignorados no degradan el estado: si solo hay páginas genéricas y
    // ningún conflicto real, la sincronización está sana.
    const status = errors ? "ERROR" : conflicts ? "CONFLICT" : "SYNCED";
    const metadata = {
      externalSource: SOURCE,
      sourceStatuses: sourceCourses.map((course) => ({ externalId: course.externalId, status: course.sourceStatus })),
      unchanged,
      ignored,
      ...reconciliation,
      conflictItems,
      ignoredItems,
      errorItems,
      missingItemsDeleted: 0,
      internalFieldsOverwritten: false,
      reconciliationSkipped: errors > 0,
    };
    await prisma.catalogSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        discovered: sourceCourses.length,
        created,
        updated,
        conflicts,
        errors,
        completedAt: new Date(),
        metadata,
      },
    });
    await writeAudit({
      session,
      action: "WORDPRESS_CATALOG_SYNCED",
      entityType: "CatalogSyncRun",
      entityId: run.id,
      result: errors ? "FAILURE" : "SUCCESS",
      metadata: { discovered: sourceCourses.length, created, updated, unchanged, ignored, conflicts, errors, ...reconciliation, readOnlySource: true },
    });
    return { runId: run.id, discovered: sourceCourses.length, created, createdCourseIds, updated, unchanged, ignored, ignoredItems, conflicts, errors, ...reconciliation };
  } catch (error) {
    const code = safeWordPressErrorCode(error);
    await prisma.catalogSyncRun.update({ where: { id: run.id }, data: { status: "ERROR", errors: 1, error: code, completedAt: new Date() } });
    await writeAudit({ session, action: "WORDPRESS_CATALOG_SYNC_FAILED", entityType: "CatalogSyncRun", entityId: run.id, result: "FAILURE", metadata: { code, readOnlySource: true } });
    throw error;
  }
}
