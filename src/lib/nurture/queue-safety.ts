import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Estados de OutboundMessage que `rescheduleCourseAutomations` sabe volver a
 * evaluar: sigue siendo cola, no historial. Vive aqui (no en engine.ts) para
 * que este modulo no dependa del motor de programacion -- son las funciones
 * de mas alto nivel las que dependen de esto, nunca al reves.
 */
export const REPROGRAMMABLE_STATUSES = ["PROGRAMADO", "OMITIDO"] as const;

/**
 * Vocabulario unico para tocar la cola de OutboundMessage.
 *
 * Antes de esto, cada endpoint que necesitaba pausar/cancelar reinventaba su
 * propio `updateMany` con su propio subconjunto de estados "todavia
 * pendiente" (algunos incluian FALLIDO, otros no; algunos limpiaban
 * `nextAttemptAt`, otros no). La regla de negocio es una sola y no deberia
 * poder divergir entre archivos:
 *
 *   reversible   -> OMITIDO + codigo recuperable (rescheduleCourseAutomations
 *                   lo vuelve a evaluar mas tarde, nunca antes de su hora).
 *   irreversible -> CANCELADO (nadie lo va a recuperar; el evento que lo causo
 *                   no se deshace).
 *
 * Nunca tocan un mensaje que ya es historial: ACEPTADO, ENVIADO, ENTREGADO,
 * LEIDO, SIMULADO, REBOTADO y ENVIANDO (una entrega en curso) quedan fuera del
 * `where` por construccion, no por disciplina de quien llama.
 */

/** Puede aceptar el cliente global o un `tx` de `prisma.$transaction`. */
export type Db = PrismaClient | Prisma.TransactionClient;

export type MotivoCola = {
  errorCode: string;
  errorMessage: string;
};

/**
 * Mensajes activos de la cola: los unicos que una cuarentena o una
 * cancelacion pueden tocar. Incluye FALLIDO ademas de PROGRAMADO porque un
 * mensaje a la espera de reintento sigue siendo cola, no historial: si no se
 * pusiera en cuarentena junto con los demas, el reintento automatico podria
 * despacharlo durante la misma pausa/cambio que se esta protegiendo.
 */
const MENSAJES_ACTIVOS = ["PROGRAMADO", "FALLIDO"] as const;

/**
 * Todo lo que NO es historial ni ya esta cancelado. Una cancelacion
 * irreversible barre tambien lo que ya estaba en cuarentena (OMITIDO): si la
 * regla se archiva, un aviso que estaba OMITIDO/RULE_PAUSED no va a volver a
 * evaluarse nunca (la regla ya no existe para reprogramarlo), asi que dejarlo
 * en OMITIDO seria una cuarentena que nadie va a revisar jamas.
 */
const MENSAJES_RECUPERABLES = [...REPROGRAMMABLE_STATUSES, "FALLIDO"] as const;

/**
 * Pausa mensajes reversiblemente: OMITIDO con un codigo que
 * `rescheduleCourseAutomations` sabe volver a evaluar cuando desaparezca la
 * condicion que los detuvo. Nunca envia tarde: si el momento ya paso, la
 * reprogramacion los deja omitidos de nuevo en vez de revivirlos.
 *
 * @param where Ademas de filtrar QUE mensajes tocar (por regla, por sesion,
 *   por curso via `enrollment.courseId`, etc.), puede incluir mas condiciones
 *   propias; el estado activo siempre se AND-ea aparte, no se puede pisar.
 * @returns cuantos mensajes se pusieron en cuarentena.
 */
export async function quarantineRecoverableMessages(db: Db, where: Prisma.OutboundMessageWhereInput, motivo: MotivoCola): Promise<number> {
  const resultado = await db.outboundMessage.updateMany({
    where: { ...where, status: { in: [...MENSAJES_ACTIVOS] } },
    data: {
      status: "OMITIDO",
      errorCode: motivo.errorCode,
      errorMessage: motivo.errorMessage,
      error: motivo.errorMessage,
      nextAttemptAt: null,
    },
  });
  return resultado.count;
}

/**
 * Cancela mensajes de forma definitiva: CANCELADO, con marca de tiempo y
 * motivo. Para un evento que no se deshace (sesion eliminada, regla
 * archivada, contacto archivado): nadie va a recuperar esto despues, asi que
 * quedarse en OMITIDO seria una cuarentena eterna en vez de un cierre.
 *
 * @returns cuantos mensajes se cancelaron.
 */
export async function cancelIrreversibleMessages(db: Db, where: Prisma.OutboundMessageWhereInput, motivo: MotivoCola): Promise<number> {
  const resultado = await db.outboundMessage.updateMany({
    where: { ...where, status: { in: [...MENSAJES_RECUPERABLES] } },
    data: {
      status: "CANCELADO",
      cancelledAt: new Date(),
      errorCode: motivo.errorCode,
      errorMessage: motivo.errorMessage,
      error: motivo.errorMessage,
    },
  });
  return resultado.count;
}
