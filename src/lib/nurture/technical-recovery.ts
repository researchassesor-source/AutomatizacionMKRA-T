import { prisma } from "@/lib/db";
import { rescheduleCourseAutomations } from "./engine";

/**
 * Códigos que significan "recalculo en curso", nunca "condición de negocio
 * sin resolver".
 *
 * La regla que ya cuarentena estos mensajes también llama a
 * rescheduleCourseAutomations en el mismo instante, así que en el camino
 * normal se resuelven casi de inmediato. Este barrido es la red por debajo:
 * si esa llamada puntual falló (un corte, un timeout) y nadie más volvió a
 * intentarlo, el mensaje quedaría OMITIDO para siempre sin este sweep.
 *
 * Deliberadamente NO incluye condiciones de negocio (HUMAN_HANDOFF_ACTIVE,
 * COURSE_AUTOMATIONS_PAUSED, RULE_PAUSED, CONTACT_ARCHIVED, CONTACT_EXCLUDED,
 * COURSE_NOT_ELIGIBLE): esas necesitan que alguien o algo externo resuelva su
 * condición primero (reanudar, restaurar, reclasificar, un nuevo sync). Un
 * barrido ciego que las tocara reviviría mensajes que un humano pausó a
 * propósito.
 */
const CODIGOS_TECNICOS = ["SCHEDULE_RECONCILING"] as const;

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
