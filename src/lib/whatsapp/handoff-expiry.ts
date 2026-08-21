import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { markCourseAutomationReconcilePending, reconcileCourseDerivedState } from "@/lib/nurture/course-reconciliation";
import { VENTANA_ATENCION_MS } from "./conversation";

/**
 * Reevalua las automatizaciones de un contacto restaurado/reclasificado como
 * REAL, o cuya atencion humana se acaba de cerrar.
 *
 * HUMAN_HANDOFF ya no calla ningun mensaje comercial (ver el comentario de
 * cabecera de `conversation.ts`), asi que esto ya no "reactiva" nada que el
 * handoff hubiera pausado. Sigue teniendo sentido igual: reclasificar o
 * desarchivar un contacto puede volverlo elegible para reglas que antes no
 * aplicaban, y cerrar una atencion humana es un buen momento para poner al
 * dia el calendario del curso si cambio mientras tanto. Pide al motor que
 * vuelva a evaluar cada curso en el que el contacto tiene inscripcion.
 *
 * Un fallo de `reconcileCourseDerivedState` aqui NO cuenta como recuperado:
 * quien llama (el cierre de un handoff, la restauracion de un contacto) no
 * debe creer que la reconciliacion funciono si en realidad fallo. Se marca
 * el curso pendiente ANTES de intentarlo; lo que falla queda para que el
 * cron lo recoja despues.
 */
export async function recuperarAutomatizacionesDelContacto(leadId: string, ahora = new Date()): Promise<number> {
  const cursos = await prisma.enrollment.findMany({
    where: { leadId },
    distinct: ["courseId"],
    select: { courseId: true },
  });
  let reprogramados = 0;
  for (const { courseId } of cursos) {
    await markCourseAutomationReconcilePending(prisma, courseId, "CONTACT_AUTOMATIONS_RECOVERED").catch(() => undefined);
    const resultado = await reconcileCourseDerivedState(courseId, null, ahora);
    if (resultado.ok) reprogramados++;
  }
  return reprogramados;
}

/** Tope por vuelta: el reloj comparte 60 s entre varios subsistemas. */
const LOTE_MAXIMO = 5;

/**
 * Libera atenciones humanas abandonadas.
 *
 * HUMAN_HANDOFF ya no pausa ninguna automatizacion (ver `conversation.ts`),
 * pero el estado sigue gobernando la asignacion y la interfaz: si nadie hace
 * clic en "Finalizar atencion", el Inbox seguiria mostrando esta
 * conversacion como atendida por un asesor para siempre. Pero "abandonada"
 * no es lo mismo que "vieja": `handoffAt` no se mueve mientras dura la
 * atencion (a proposito, para no falsear cuando empezo), asi que una
 * conversacion con idas y vueltas activas hace HORAS igual tendria un
 * `handoffAt` de hace mas de 24 h. Cerrarla solo por eso interrumpiria una
 * atencion en curso.
 *
 * Lo que importa es la ULTIMA actividad real: el mayor entre lo que escribio
 * el contacto (`lastInboundAt`) y la ultima respuesta HUMANA que salio
 * (`lastOutboundAt`, que solo mueve `enviarRespuestaHumana` — el envio
 * automatico nunca lo toca). `handoffAt` sigue sirviendo de prefiltro barato
 * en la consulta: nunca puede ser mas reciente que la primera actividad que
 * abrio el handoff, asi que toda conversacion realmente vencida lo cumple
 * tambien; lo que cambia es que ya no basta por si solo.
 */
export async function expirarAtencionesHumanas(ahora = new Date()) {
  const limite = new Date(ahora.getTime() - VENTANA_ATENCION_MS);
  const candidatas = await prisma.conversation.findMany({
    where: { state: "HUMAN_HANDOFF", handoffAt: { lte: limite } },
    select: { id: true, leadId: true, handoffAt: true, lastInboundAt: true, lastOutboundAt: true },
    take: LOTE_MAXIMO,
  });

  let liberadas = 0;
  let cursosReprogramados = 0;
  for (const conversacion of candidatas) {
    const señales = [conversacion.handoffAt, conversacion.lastInboundAt, conversacion.lastOutboundAt]
      .filter((fecha): fecha is Date => fecha !== null);
    const ultimaActividad = señales.reduce((max, fecha) => (fecha > max ? fecha : max));
    // Actividad dentro de la ventana: la atencion sigue viva, no se toca.
    if (ultimaActividad > limite) continue;

    const reclamada = await prisma.conversation.updateMany({
      where: { id: conversacion.id, state: "HUMAN_HANDOFF" },
      data: { state: "RESOLVED", resolvedAt: ahora, resolvedBy: "automation" },
    });
    if (reclamada.count !== 1) continue;
    liberadas++;
    await writeAudit({
      actorEmail: "automation",
      action: "WHATSAPP_HANDOFF_AUTO_RESOLVED",
      entityType: "Conversation",
      entityId: conversacion.id,
      result: "SUCCESS",
      metadata: { motivo: "SIN_ACTIVIDAD_24H" },
    });
    if (conversacion.leadId) {
      cursosReprogramados += await recuperarAutomatizacionesDelContacto(conversacion.leadId, ahora);
    }
  }
  return { liberadas, cursosReprogramados };
}
