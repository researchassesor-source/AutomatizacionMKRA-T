import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";
import { VENTANA_ATENCION_MS } from "./conversation";

/**
 * Recupera lo comercial que quedo callado por una atencion humana ya cerrada.
 *
 * `automatizacionPermitida` calla los mensajes comerciales de ESTE contacto
 * mientras dura el handoff (OMITIDO, no CANCELADO: reprogramable). Pero nada
 * los reactiva solo, ni siquiera al cerrar la atencion: hace falta pedirle al
 * motor que vuelva a evaluar el curso. `rescheduleCourseAutomations` ya
 * protege contra revivir un mensaje cuyo momento paso (se omite de nuevo, no
 * se envia tarde), asi que aqui basta con volver a llamarlo por cada curso en
 * el que el contacto tiene inscripcion.
 */
export async function recuperarAutomatizacionesDelContacto(leadId: string, ahora = new Date()): Promise<number> {
  const cursos = await prisma.enrollment.findMany({
    where: { leadId },
    distinct: ["courseId"],
    select: { courseId: true },
  });
  let reprogramados = 0;
  for (const { courseId } of cursos) {
    await rescheduleCourseAutomations(courseId, ahora).catch(() => undefined);
    reprogramados++;
  }
  return reprogramados;
}

/** Tope por vuelta: el reloj comparte 60 s entre varios subsistemas. */
const LOTE_MAXIMO = 5;

/**
 * Libera atenciones humanas abandonadas.
 *
 * Si nadie hace clic en "Cerrar atencion", HUMAN_HANDOFF bloquearia lo
 * comercial de ese contacto para siempre. Pero "abandonada" no es lo mismo
 * que "vieja": `handoffAt` no se mueve mientras dura la atencion (a
 * proposito, para no falsear cuando empezo), asi que una conversacion con
 * idas y vueltas activas hace HORAS igual tendria un `handoffAt` de hace mas
 * de 24 h. Cerrarla solo por eso interrumpiria una atencion en curso.
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
