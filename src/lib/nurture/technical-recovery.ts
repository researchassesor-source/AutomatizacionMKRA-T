import { prisma } from "@/lib/db";
import { rescheduleCourseAutomations } from "./engine";

/**
 * Códigos que significan "recalculo en curso" o "política ya revertida",
 * nunca "condición de negocio sin resolver".
 *
 * La regla que ya cuarentena SCHEDULE_RECONCILING también llama a
 * rescheduleCourseAutomations en el mismo instante, así que en el camino
 * normal se resuelve casi de inmediato. Este barrido es la red por debajo:
 * si esa llamada puntual falló (un corte, un timeout) y nadie más volvió a
 * intentarlo, el mensaje quedaría OMITIDO para siempre sin este sweep.
 *
 * HUMAN_HANDOFF_ACTIVE entra aquí desde el cierre de producción que eliminó
 * ese gate (ver `conversation.ts`): un mensaje con este código es un residuo
 * de una política que ya no existe, no una condición que alguien deba
 * resolver a mano. `scheduleEnrollmentAutomations` ya no lo va a volver a
 * poner — solo puede quedar de mensajes viejos, cuarentenados antes de este
 * cambio — y recalcularlo es seguro: si el mensaje sigue en el futuro
 * vuelve a PROGRAMADO, y si ya quedó en el pasado el propio recalculo lo
 * deja como está (ver el filtro de `oldestAllowed` en
 * `scheduleEnrollmentAutomations`), nunca lo dispara como backlog.
 *
 * Deliberadamente NO incluye condiciones de negocio que siguen vigentes
 * (COURSE_AUTOMATIONS_PAUSED, RULE_PAUSED, CONTACT_ARCHIVED,
 * CONTACT_EXCLUDED, COURSE_NOT_ELIGIBLE): esas necesitan que alguien o algo
 * externo resuelva su condición primero (reanudar, restaurar, reclasificar,
 * un nuevo sync). Un barrido ciego que las tocara reviviría mensajes que un
 * humano pausó a propósito.
 */
const CODIGOS_TECNICOS = ["SCHEDULE_RECONCILING", "HUMAN_HANDOFF_ACTIVE"] as const;

/** Tope por vuelta: el reloj comparte 60 s entre varios subsistemas. */
const CURSOS_MAXIMO = 5;

/**
 * Recupera cursos con mensajes atascados en un código técnico.
 *
 * Agrupa por curso (no por mensaje): rescheduleCourseAutomations ya recorre
 * toda la cola de un curso de una vez, así que llamarlo una vez por curso
 * cubre todos sus mensajes atascados en el mismo barrido.
 */
export async function recuperarCodigosTecnicosAtascados(ahora = new Date()) {
  const atascados = await prisma.outboundMessage.findMany({
    where: { status: "OMITIDO", errorCode: { in: [...CODIGOS_TECNICOS] } },
    select: { enrollment: { select: { courseId: true } } },
    distinct: ["enrollmentId"],
    take: 200,
  });
  const courseIds = [...new Set(atascados.map((m) => m.enrollment?.courseId).filter((id): id is string => Boolean(id)))].slice(0, CURSOS_MAXIMO);

  let cursos = 0;
  for (const courseId of courseIds) {
    await rescheduleCourseAutomations(courseId, ahora).catch(() => undefined);
    cursos++;
  }
  return { cursos };
}
