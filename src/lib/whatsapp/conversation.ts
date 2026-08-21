import type { ConversationState } from "@prisma/client";

/**
 * Reglas de una conversacion de WhatsApp: ventana de atencion y handoff.
 *
 * Todo aqui es una funcion pura sobre datos ya leidos. La interfaz y el
 * endpoint de respuesta hacen la misma pregunta —¿puedo escribir texto
 * libre?— y dos copias que pueden discrepar es como se acaba enviando texto
 * fuera de plazo, que Meta rechaza.
 *
 * Cierre de producción: HUMAN_HANDOFF ya NO calla ninguna automatización (ver
 * `scheduleEnrollmentAutomations`/`sendMessage` en el motor). Es una decisión
 * de producto deliberada, no un bug: un humano puede atender en cualquier
 * momento sin pausar el journey, comercial u operativo. El estado se
 * mantiene solo para interfaz, asignación de asesor y auditoría — por eso
 * este módulo ya no expone una función de "automatización permitida": no
 * hay ninguna decisión de negocio que tomar sobre ese estado, solo mostrarlo.
 * `whatsappCustomerServiceWindow`/`admiteTextoLibre` siguen intactas: esa es
 * la ventana real de 24 h de Meta para texto libre humano, un límite del
 * proveedor, no una política del CRM.
 */

/** Meta abre 24 horas desde el ULTIMO mensaje del usuario, no desde el primero. */
export const VENTANA_ATENCION_MS = 24 * 60 * 60 * 1000;

export type VentanaAtencion =
  | { abierta: true; expiraEn: Date; restanteMs: number }
  | { abierta: false; motivo: "SIN_MENSAJES" | "EXPIRADA" };

/**
 * Estado de la ventana de servicio.
 *
 * Dentro de ella la empresa puede responder con texto libre. Fuera, Meta solo
 * admite plantillas aprobadas: no es una preferencia del CRM, es su politica, y
 * mandar texto igualmente termina en un rechazo del proveedor.
 */
export function whatsappCustomerServiceWindow(
  ultimoEntranteAt: Date | null | undefined,
  ahora: Date = new Date(),
): VentanaAtencion {
  if (!ultimoEntranteAt) return { abierta: false, motivo: "SIN_MENSAJES" };
  const expiraEn = new Date(ultimoEntranteAt.getTime() + VENTANA_ATENCION_MS);
  const restanteMs = expiraEn.getTime() - ahora.getTime();
  if (restanteMs <= 0) return { abierta: false, motivo: "EXPIRADA" };
  return { abierta: true, expiraEn, restanteMs };
}

/** Texto para la interfaz. El backend vuelve a decidir por su cuenta. */
export function describirVentana(ventana: VentanaAtencion): string {
  if (!ventana.abierta) {
    return ventana.motivo === "SIN_MENSAJES"
      ? "Sin mensajes del contacto · usa plantilla"
      : "Ventana cerrada · usa plantilla";
  }
  const horas = Math.floor(ventana.restanteMs / 3_600_000);
  const minutos = Math.floor((ventana.restanteMs % 3_600_000) / 60_000);
  return horas > 0 ? `Ventana abierta · quedan ${horas} h ${minutos} min` : `Ventana abierta · quedan ${minutos} min`;
}

/** ¿Puede enviarse texto libre iniciado por la empresa? */
export function admiteTextoLibre(ventana: VentanaAtencion): boolean {
  return ventana.abierta;
}

/**
 * ¿Un mensaje entrante debe abrir atencion humana?
 *
 * Solo desde AUTOMATION. Si ya hay handoff no se reabre —seria ruido en la
 * auditoria— y si la conversacion se dio por resuelta, que el contacto vuelva a
 * escribir significa justamente que no lo estaba.
 */
export function debeAbrirHandoff(estado: ConversationState | null | undefined): boolean {
  return estado !== "HUMAN_HANDOFF";
}
