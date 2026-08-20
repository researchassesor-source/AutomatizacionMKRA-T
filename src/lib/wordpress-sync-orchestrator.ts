/**
 * Orquestador único del sincronizado con WordPress.
 *
 * Antes el flujo vivía repartido entre el cliente y una ruta por curso:
 * sincronizar catálogo, refrescar la lista EN EL NAVEGADOR, y recién ahí
 * lanzar un GET por curso usando esa lista ya vieja. Un curso nuevo,
 * descubierto por el mismo sync, nunca entraba en esa vuelta porque el
 * navegador seguía iterando la lista de ANTES del sync — hacía falta un
 * segundo clic. Aquí vive la versión de un solo viaje: el catálogo se
 * sincroniza, se vuelve a leer la lista resultante DEL LADO DEL SERVIDOR
 * (nunca la de antes), y el calendario de cada curso se lee en la misma
 * ejecución.
 *
 * Las piezas que ya existían y ya estaban probadas (parseo del HTML,
 * comparación de calendario, transacción de aplicación) se REUTILIZAN tal
 * cual, no se rehacen: `schedule-proposal/route.ts` (GET y POST, por curso)
 * ahora son envoltorios delgados sobre las mismas funciones de aquí.
 */

import type { AdminSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import {
  calendarRevisionOf,
  compareCourseSchedule,
  planScheduleReconciliation,
  type ExistingSession,
  type ProposedSession,
  type ReconciliationPlan,
} from "@/lib/course-schedule-reconciliation";
import { proponerCalendario, type SesionPropuesta } from "@/lib/course-schedule-parser";
import { prisma } from "@/lib/db";
import { markCourseAutomationReconcilePending, reconcileCourseDerivedState, type ReconcileCourseResult } from "@/lib/nurture/course-reconciliation";
import { cancelIrreversibleMessages, quarantineCourseCalendarDependentMessages } from "@/lib/nurture/queue-safety";
import { safeWordPressErrorCode, synchronizeWordPressCatalog } from "@/lib/wordpress-catalog";

const DOMINIO_OFICIAL = "ra-training.com";

export type ExistingSessionJSON = { startAt: string; endAt: string | null };

function existingSessionsResponse(sessions: Array<{ startAt: Date; endAt: Date | null }>): ExistingSessionJSON[] {
  return sessions.map((session) => ({ startAt: session.startAt.toISOString(), endAt: session.endAt?.toISOString() ?? null }));
}

type CourseForAnalysis = {
  id: string;
  title: string;
  officialUrl: string | null;
  officialCourseUrl: string;
  sessions: ExistingSession[];
};

/**
 * Estado de UN curso frente al calendario publicado. Superconjunto del
 * `ScheduleComparisonStatus` puro: agrega los estados que dependen de poder
 * leer la web (sin URL válida, sin fecha publicada, error de red) y, para el
 * barrido global, si el curso es nuevo en el CRM.
 */
export type WordPressSyncCourseStatus = "UNCHANGED" | "NEW_COURSE" | "SCHEDULE_CHANGED" | "NO_SCHEDULE_SOURCE" | "ERROR";

export type CourseScheduleAnalysis = {
  courseId: string;
  courseTitle: string;
  /** Estado "clasico" (compatibilidad con schedule-proposal GET, por curso). */
  status: "SIN_CALENDARIO_CRM" | "CALENDARIO_IGUAL" | "CALENDARIO_CAMBIADO" | "SIN_FECHA_EN_WORDPRESS" | "ERROR";
  ok: boolean;
  motivo?: string;
  fuenteInicio?: string | null;
  fuenteHorario?: string | null;
  horaAsumida?: boolean;
  sessions?: SesionPropuesta[];
  sourceUrl?: string;
  existingSessions: ExistingSessionJSON[];
  calendarRevision: string;
};

/**
 * Lee la ficha pública del curso y compara contra su calendario actual.
 *
 * Solo lee. Nunca crea ni modifica una sesión: eso lo decide
 * `applyCourseSchedule`, siempre después de una confirmación humana.
 */
export async function analyzeCourseSchedule(course: CourseForAnalysis): Promise<CourseScheduleAnalysis> {
  const existingSessions = existingSessionsResponse(course.sessions);
  const calendarRevision = calendarRevisionOf(course.sessions);
  const base = { courseId: course.id, courseTitle: course.title, existingSessions, calendarRevision };

  const raw = course.officialUrl ?? course.officialCourseUrl;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ...base, ok: false, status: "ERROR", motivo: "El curso no tiene una dirección web válida." };
  }
  if (url.protocol !== "https:" || (url.hostname !== DOMINIO_OFICIAL && url.hostname !== `www.${DOMINIO_OFICIAL}`)) {
    return { ...base, ok: false, status: "ERROR", motivo: "La dirección del curso no pertenece al sitio oficial." };
  }

  let html: string;
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "RA-Training-CRM/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return { ...base, ok: false, status: "ERROR", motivo: `La página del curso respondió ${response.status}.` };
    }
    html = await response.text();
  } catch {
    return { ...base, ok: false, status: "ERROR", motivo: "No se pudo abrir la página del curso." };
  }

  const propuesta = proponerCalendario(html);
  if (!propuesta.ok) {
    return { ...base, ok: false, status: "SIN_FECHA_EN_WORDPRESS", motivo: propuesta.motivo, fuenteInicio: propuesta.fuenteInicio, fuenteHorario: propuesta.fuenteHorario };
  }
  const status = compareCourseSchedule(course.sessions, propuesta.sessions);
  return {
    ...base,
    ok: true,
    status,
    sourceUrl: url.toString(),
    sessions: propuesta.sessions,
    fuenteInicio: propuesta.fuenteInicio,
    fuenteHorario: propuesta.fuenteHorario,
    horaAsumida: propuesta.horaAsumida,
  };
}

export type ApplyCourseScheduleResult =
  | { ok: true; updated: number; removed: number; created: number; cancelledMessages: number; quarantinedMessages: number; reconciled: ReconcileCourseResult }
  | { ok: false; code: "COURSE_NOT_FOUND" }
  | { ok: false; code: "REVISION_MISMATCH" }
  | { ok: false; code: "TRANSACTION_FAILED" };

/**
 * Aplica un calendario YA CONFIRMADO por una persona para UN curso.
 *
 * Reutilizada tal cual por la ruta por curso (schedule-proposal POST) y por
 * el apply global (Sección L): la transacción, la cuarentena y la
 * reconciliación posterior son exactamente las mismas en los dos caminos.
 *
 * La cuarentena alcanza a TODOS los mensajes AUTOMATION todavía recuperables
 * del curso, no solo a `courseSessionId IN [las sesiones que cambiaron]`
 * (bug real corregido en esta continuación): `resolveCourseSessions` asigna
 * "sesión X de Y" por orden cronológico de TODAS las sesiones, así que
 * borrar o crear una desplaza esos números para las demás -3 sesiones -> 2
 * convierte "sesión 2 de 3" en "sesión 1 de 2"-, aunque su propia fecha no
 * haya cambiado. Las sesiones ELIMINADAS son aparte: sus propios mensajes se
 * cancelan de forma irreversible (SESSION_REMOVED), porque ese destino
 * concreto ya no existe.
 */
export async function applyCourseSchedule(
  courseId: string,
  input: { calendarRevision: string; sessions: ProposedSession[] },
  actor?: AdminSession | null,
): Promise<ApplyCourseScheduleResult> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return { ok: false, code: "COURSE_NOT_FOUND" };

  let plan: ReconciliationPlan = { toUpdate: [], toRemove: [], toCreate: [] };
  let revisionMismatch = false;
  let cancelledMessages = 0;
  let quarantinedMessages = 0;

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.courseSession.findMany({ where: { courseId }, select: { id: true, startAt: true, endAt: true } });
      if (calendarRevisionOf(existing) !== input.calendarRevision) {
        revisionMismatch = true;
        return;
      }
      plan = planScheduleReconciliation(existing, input.sessions);
      const hayCambioEstructural = plan.toUpdate.length > 0 || plan.toRemove.length > 0 || plan.toCreate.length > 0;

      if (plan.toRemove.length > 0) {
        const removedIds = plan.toRemove.map((session) => session.id);
        cancelledMessages = await cancelIrreversibleMessages(
          tx,
          { courseSessionId: { in: removedIds } },
          { errorCode: "SESSION_REMOVED", errorMessage: "La sesión asociada dejó de existir." },
        );
        await tx.courseSession.deleteMany({ where: { id: { in: removedIds } } });
      }
      if (hayCambioEstructural) {
        quarantinedMessages = await quarantineCourseCalendarDependentMessages(
          tx,
          courseId,
          { errorCode: "SCHEDULE_RECONCILING", errorMessage: "El calendario cambió y este aviso está esperando ser recalculado." },
        );
      }
      for (const update of plan.toUpdate) {
        await tx.courseSession.update({ where: { id: update.id }, data: { startAt: update.startAt, endAt: update.endAt } });
      }
      for (const create of plan.toCreate) {
        await tx.courseSession.create({ data: { courseId, startAt: create.startAt, endAt: create.endAt } });
      }
      if (hayCambioEstructural) {
        await markCourseAutomationReconcilePending(tx, courseId, "WORDPRESS_CALENDAR_APPLIED");
      }
    }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 20_000 });
  } catch {
    return { ok: false, code: "TRANSACTION_FAILED" };
  }

  if (revisionMismatch) return { ok: false, code: "REVISION_MISMATCH" };

  await writeAudit({
    session: actor,
    action: "COURSE_SCHEDULE_RECONCILED",
    entityType: "Course",
    entityId: courseId,
    metadata: { updated: plan.toUpdate.length, removed: plan.toRemove.length, created: plan.toCreate.length, cancelledMessages, quarantinedMessages },
  });

  /**
   * El calendario YA está confirmado en la base a partir de aquí. La
   * reconciliación derivada (fechas del curso, cola, nextExecutionAt de
   * reglas fijas y oferta #12) queda a cargo de reconcileCourseDerivedState,
   * que reintenta hasta dos veces y, si aun así falla, deja el curso
   * pendiente para que el cron lo recupere -- nunca "no se aplicó ningún
   * cambio", porque sí se aplicó.
   */
  const reconciled = await reconcileCourseDerivedState(courseId, actor);

  return {
    ok: true,
    updated: plan.toUpdate.length,
    removed: plan.toRemove.length,
    created: plan.toCreate.length,
    cancelledMessages,
    quarantinedMessages,
    reconciled,
  };
}

export type WordPressSyncDiffItem = {
  courseId: string;
  courseTitle: string;
  status: WordPressSyncCourseStatus;
  motivo?: string;
  fuenteInicio?: string | null;
  sessions?: SesionPropuesta[];
  existingSessions: ExistingSessionJSON[];
  calendarRevision: string;
  enrollments: number;
};

export type WordPressSyncAnalysis = {
  ok: boolean;
  catalogError?: string;
  totals: { unchanged: number; newCourse: number; scheduleChanged: number; noScheduleSource: number; error: number };
  items: WordPressSyncDiffItem[];
};

/**
 * ANALYZE WORDPRESS SYNC: la operación completa en una sola ejecución de
 * servidor.
 *
 * 1. Sincroniza y valida el catálogo completo (`synchronizeWordPressCatalog`,
 *    ya existente): descubre cursos nuevos, los crea, marca históricos los
 *    que ya no aparecen. Falla cerrado ante un catálogo incompleto o vacío.
 * 2. Vuelve a leer la lista de cursos publicados y gestionados DESPUÉS de esa
 *    sincronización — nunca la de antes — así que un curso nuevo entra en el
 *    mismo barrido de calendario que lo descubrió.
 * 3. Lee y compara el calendario de cada uno en esta misma ejecución.
 *
 * Si el catálogo falla (incompleto/vacío/red), no se leen calendarios: es
 * mejor un `ok:false` explícito que un diff calculado sobre una lista a
 * medias.
 */
export async function analyzeWordPressSync(session: AdminSession | null, fetcher: typeof fetch = fetch): Promise<WordPressSyncAnalysis> {
  const totals = { unchanged: 0, newCourse: 0, scheduleChanged: 0, noScheduleSource: 0, error: 0 };
  let nuevosDelSync = new Set<string>();

  if (!session) {
    return { ok: false, catalogError: "Sesión no válida.", totals, items: [] };
  }
  try {
    const resultado = await synchronizeWordPressCatalog(session, fetcher);
    nuevosDelSync = new Set(resultado.createdCourseIds);
  } catch (error) {
    return {
      ok: false,
      catalogError: `La sincronización se detuvo de forma segura (${safeWordPressErrorCode(error)}).`,
      totals,
      items: [],
    };
  }

  const courses = await prisma.course.findMany({
    where: { isPublished: true, externalSource: "wordpress", externalId: { not: null } },
    select: {
      id: true, title: true, officialUrl: true, officialCourseUrl: true,
      sessions: { select: { id: true, startAt: true, endAt: true }, orderBy: { startAt: "asc" } },
      _count: { select: { enrollments: true } },
    },
    orderBy: { title: "asc" },
  });

  const items: WordPressSyncDiffItem[] = [];
  for (const course of courses) {
    const analysis = await analyzeCourseSchedule(course);
    const status: WordPressSyncCourseStatus = !analysis.ok
      ? analysis.status === "SIN_FECHA_EN_WORDPRESS" ? "NO_SCHEDULE_SOURCE" : "ERROR"
      : analysis.status === "CALENDARIO_IGUAL" ? "UNCHANGED"
        : nuevosDelSync.has(course.id) ? "NEW_COURSE"
          : "SCHEDULE_CHANGED";

    if (status === "UNCHANGED") { totals.unchanged++; continue; }
    if (status === "NEW_COURSE") totals.newCourse++;
    else if (status === "SCHEDULE_CHANGED") totals.scheduleChanged++;
    else if (status === "NO_SCHEDULE_SOURCE") totals.noScheduleSource++;
    else totals.error++;

    items.push({
      courseId: course.id,
      courseTitle: course.title,
      status,
      motivo: analysis.motivo,
      fuenteInicio: analysis.fuenteInicio,
      sessions: analysis.sessions,
      existingSessions: analysis.existingSessions,
      calendarRevision: analysis.calendarRevision,
      enrollments: course._count.enrollments,
    });
  }

  return { ok: true, totals, items };
}
