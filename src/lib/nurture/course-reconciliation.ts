import type { AdminSession } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { nextFixedRuleExecution } from "@/lib/automation-schedule";
import { courseAutomationWindow } from "@/lib/course-automation-window";
import { reprogramarOfertaAutomatica } from "@/lib/commerce/offer-campaign";
import { rescheduleCourseAutomations } from "./engine";
import type { Db } from "./queue-safety";

/**
 * Reconciliación derivada persistente de un curso.
 *
 * Antes, cada mutación que necesitaba `rescheduleCourseAutomations` (o
 * `reprogramarOfertaAutomatica`) lo llamaba una vez y, si fallaba, se
 * limitaba a un `.catch(() => null)` -- el cambio real (fecha, enlace,
 * regla) SÍ quedaba guardado, pero nada volvía a intentar recalcular lo
 * derivado si esa llamada puntual fallaba (un corte, un timeout) y nadie más
 * tocaba ese curso por otro motivo. Un mensaje podía quedar con el enlace
 * viejo, o "sesión 2 de 3" cuando ya eran solo 2, indefinidamente.
 *
 * Ahora: `markCourseAutomationReconcilePending` se llama DENTRO de la misma
 * transacción que guarda la mutación real, así que el flag sobrevive aunque
 * el proceso se caiga justo después del commit. `reconcileCourseDerivedState`
 * hace hasta dos intentos inmediatos del paquete completo (fechas, cola,
 * nextExecutionAt de reglas fijas, oferta #12) y solo limpia el flag si TODO
 * salió bien; si no, lo deja (o lo marca) pendiente para que el cron lo
 * recupere -- ver recuperarReconciliacionesPendientes más abajo.
 */

/**
 * Marca un curso como pendiente de reconciliación derivada.
 *
 * Se llama DENTRO de la transacción que guarda la mutación real. No pisa una
 * razón ya existente con el mismo instante: si el curso ya estaba pendiente
 * por otro motivo sin resolver, esta escritura solo actualiza el motivo más
 * reciente, nunca borra la señal.
 */
export async function markCourseAutomationReconcilePending(db: Db, courseId: string, reason: string): Promise<void> {
  await db.course.update({
    where: { id: courseId },
    data: { automationReconcilePendingAt: new Date(), automationReconcileReason: reason },
  });
}

export type ReconcileCourseResult =
  | {
      ok: true;
      startsAt: Date | null;
      endsAt: Date | null;
      rescheduled: Awaited<ReturnType<typeof rescheduleCourseAutomations>>;
      rulesRefreshed: number;
    }
  | { ok: false; pending: true };

/** Tope duro: nunca puede haber más reglas fijas activas que esto en un curso real. */
const MAX_REGLAS_FIJAS = 200;

async function intentarReconciliar(courseId: string, actor: AdminSession | null | undefined, now: Date) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { sessions: { orderBy: { startAt: "asc" } } },
  });
  if (!course) throw new Error("COURSE_NOT_FOUND");

  const window = courseAutomationWindow(course, course.sessions);

  /**
   * 1. Course.startsAt/endsAt coherentes con CourseSession.
   *
   * Las rutas de sesión (CRUD manual) nunca tocaban estos dos campos del
   * curso, solo `wordpress-catalog.ts` en su propio camino de sincronización
   * inicial. Cualquier código que leyera `course.startsAt` directamente (en
   * vez de pasar por `resolveCourseSessions`) veía la fecha VIEJA aunque
   * `CourseSession` ya tuviera la nueva.
   */
  if (window.startsAt?.getTime() !== course.startsAt?.getTime() || window.endsAt?.getTime() !== course.endsAt?.getTime()) {
    await prisma.course.update({ where: { id: courseId }, data: { startsAt: window.startsAt, endsAt: window.endsAt } });
  }

  // 2. Recalcula la cola de recordatorios de todas las inscripciones vigentes.
  const rescheduled = await rescheduleCourseAutomations(courseId, now);

  /**
   * 3. nextExecutionAt de las reglas de horario fijo (BEFORE_COURSE/
   * AFTER_COURSE). El motor solo lo escribe al crear o editar una regla
   * (nextFixedRuleExecution contra la ventana de ESE momento); un cambio de
   * calendario por cualquier otra vía lo deja apuntando a la ventana VIEJA
   * si nada más lo refresca.
   */
  const reglasFijas = await prisma.automationRule.findMany({
    where: { courseId, status: "ACTIVE", trigger: { in: ["BEFORE_COURSE", "AFTER_COURSE"] } },
    select: { id: true, trigger: true, offsetMinutes: true, nextExecutionAt: true },
    take: MAX_REGLAS_FIJAS,
  });
  let rulesRefreshed = 0;
  for (const regla of reglasFijas) {
    const nuevo = nextFixedRuleExecution({ trigger: regla.trigger, offsetMinutes: regla.offsetMinutes, startsAt: window.startsAt, endsAt: window.endsAt }, now);
    if ((nuevo?.getTime() ?? null) !== (regla.nextExecutionAt?.getTime() ?? null)) {
      await prisma.automationRule.update({ where: { id: regla.id }, data: { nextExecutionAt: nuevo } });
      rulesRefreshed++;
    }
  }

  /**
   * 4. Oferta institucional automática #12: parte de la MISMA
   * reconciliación, no un aparte silencioso después. Antes, si el reschedule
   * fallaba dos veces, `applyCourseSchedule` devolvía RESCHEDULE_FAILED sin
   * haber llegado siquiera a llamar `reprogramarOfertaAutomatica` -- #12
   * podía quedar con la fecha vieja indefinidamente. Ya es idempotente y
   * conservador por diseño (nunca toca COMPLETED/RUNNING), así que incluirla
   * aquí no cambia su comportamiento, solo garantiza que se re-intenta junto
   * con todo lo demás.
   */
  await reprogramarOfertaAutomatica(courseId, actor);

  return { ok: true as const, startsAt: window.startsAt, endsAt: window.endsAt, rescheduled, rulesRefreshed };
}

/** Máximo de intentos inmediatos antes de dejarlo para el cron. */
const MAX_INTENTOS = 2;

/**
 * Reconciliación completa del estado derivado de un curso: fechas, cola de
 * recordatorios, nextExecutionAt de reglas fijas y oferta #12, como un solo
 * paquete.
 *
 * Hasta dos intentos inmediatos. Si ambos fallan, el flag queda (o se marca)
 * pendiente para que `recuperarReconciliacionesPendientes` lo recupere en un
 * tick posterior -- nunca se propaga el error crudo (puede arrastrar datos
 * de contacto o del proveedor), y nunca se limpia el flag sin haber
 * completado TODO el paquete con éxito.
 *
 * Marca pendiente al empezar (sin pisar una razón ya existente, vía
 * `updateMany` condicional) por si quien llama olvidó marcarlo dentro de su
 * propia transacción: es la red de seguridad, no el mecanismo principal.
 */
export async function reconcileCourseDerivedState(courseId: string, actor?: AdminSession | null, now = new Date()): Promise<ReconcileCourseResult> {
  await prisma.course.updateMany({
    where: { id: courseId, automationReconcilePendingAt: null },
    data: { automationReconcilePendingAt: now, automationReconcileReason: "RECONCILE_STARTED" },
  }).catch(() => undefined);

  let ultimoError: unknown = null;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const resultado = await intentarReconciliar(courseId, actor, now);
      await prisma.course.update({
        where: { id: courseId },
        data: { automationReconcilePendingAt: null, automationReconcileReason: null },
      }).catch(() => undefined);
      return resultado;
    } catch (error) {
      ultimoError = error;
    }
  }

  await writeAudit({
    actorEmail: actor?.email ?? "automation",
    action: "COURSE_RECONCILE_FAILED",
    entityType: "Course",
    entityId: courseId,
    result: "FAILURE",
    // Nunca el mensaje crudo (ni siquiera recortado): puede venir de un
    // proveedor externo (Finance, WhatsApp, WordPress) y arrastrar datos de
    // contacto o algo con forma de secreto. Solo se reconoce el puñado de
    // códigos propios y conocidos; cualquier otra cosa cae en un balde
    // genérico -- clasificar más fino no vale el riesgo de filtrar algo.
    metadata: { intentos: MAX_INTENTOS, errorCode: clasificarErrorDeReconciliacion(ultimoError) },
  }).catch(() => undefined);

  return { ok: false, pending: true };
}

const CODIGOS_PROPIOS_CONOCIDOS = new Set(["COURSE_NOT_FOUND"]);

function clasificarErrorDeReconciliacion(error: unknown): string {
  const mensaje = error instanceof Error ? error.message : "";
  if (CODIGOS_PROPIOS_CONOCIDOS.has(mensaje)) return mensaje;
  return "RECONCILE_STEP_FAILED";
}

/** Tope por vuelta: el reloj comparte 60 s entre varios subsistemas. */
const CURSOS_MAXIMO_CRON = 5;

/**
 * Cursos con reconciliación derivada pendiente (recuperación durable).
 *
 * Complementa -no reemplaza- `recuperarCodigosTecnicosAtascados`: ese barre
 * OutboundMessage YA atascados en un código técnico; este cubre el caso
 * donde TODAVÍA no existe ningún mensaje que delate el problema -una sesión
 * recién creada sin inscripciones previas, por ejemplo- porque la señal vive
 * en el propio Course, no en un mensaje. Los más antiguos primero.
 */
export async function recuperarReconciliacionesPendientes(ahora = new Date()) {
  const pendientes = await prisma.course.findMany({
    where: { automationReconcilePendingAt: { not: null } },
    select: { id: true },
    orderBy: { automationReconcilePendingAt: "asc" },
    take: CURSOS_MAXIMO_CRON,
  });

  let recuperados = 0;
  for (const curso of pendientes) {
    const resultado = await reconcileCourseDerivedState(curso.id, null, ahora);
    if (resultado.ok) recuperados++;
  }
  return { cursos: pendientes.length, recuperados };
}
