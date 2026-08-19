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
 * comercial de ese contacto para siempre. Se usa la misma ventana de 24 h que
 * ya rige el envio libre de WhatsApp: pasado ese plazo desde que se abrio la
 * atencion, se asume abandonada y se libera sola.
 *
 * Reclamo optimista (`updateMany` condicionado al estado actual) para que dos
 * vueltas del cron no liberen la misma conversacion dos veces ni pisen a un
 * asesor que la cerro a mano en el instante exacto.
 */
export async function expirarAtencionesHumanas(ahora = new Date()) {
  const limite = new Date(ahora.getTime() - VENTANA_ATENCION_MS);
  const vencidas = await prisma.conversation.findMany({
    where: { state: "HUMAN_HANDOFF", handoffAt: { lte: limite } },
    select: { id: true, leadId: true },
    take: LOTE_MAXIMO,
  });

  let liberadas = 0;
  let cursosReprogramados = 0;
  for (const conversacion of vencidas) {
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
      metadata: { motivo: "SIN_CIERRE_MANUAL_24H" },
    });
    if (conversacion.leadId) {
      cursosReprogramados += await recuperarAutomatizacionesDelContacto(conversacion.leadId, ahora);
    }
  }
  return { liberadas, cursosReprogramados };
}
