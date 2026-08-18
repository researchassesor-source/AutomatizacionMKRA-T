import type { ConversationState } from "@prisma/client";

/**
 * Reglas de una conversacion de WhatsApp: ventana de atencion y handoff.
 *
 * Todo aqui es una funcion pura sobre datos ya leidos. La interfaz, el endpoint
 * de respuesta y el motor de automatizaciones hacen las mismas dos preguntas
 * —¿puedo escribir texto libre? ¿esta esta persona siendo atendida?— y tres
 * copias que pueden discrepar es como se acaba enviando texto libre fuera de
 * plazo, que Meta rechaza, o un mensaje comercial encima de un asesor.
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
 * Momentos que NO se callan durante una atencion humana.
 *
 * Son los que dan acceso al curso. Si alguien escribe una duda diez minutos
 * antes de su sesion y por eso deja de recibir el enlace, la conversacion le
 * habra costado la clase. El asesor no compite con estos: no venden nada.
 */
const MOMENTOS_OPERATIVOS: ReadonlySet<string> = new Set([
  "reminder_24h",
  "reminder_2h",
  "reminder_15m",
  "session_live",
  "late_access",
  "thank_you",
]);

/**
 * Momentos comerciales, que si se callan mientras hay un asesor.
 *
 * `welcome` y `whatsapp_group` entran aqui por ser conversacionales: dar la
 * bienvenida automatica a quien ya esta hablando con una persona suena a que
 * nadie le esta leyendo.
 */
export function esMomentoOperativo(planKey: string | null | undefined): boolean {
  return planKey ? MOMENTOS_OPERATIVOS.has(planKey) : false;
}

/**
 * ¿Puede salir esta automatizacion con la conversacion en este estado?
 *
 * Falla hacia el lado seguro para el contacto: en duda, el mensaje operativo
 * sale. Perder un enlace de acceso es un dano concreto; un comercial de mas es
 * una molestia, y es la que se evita.
 */
export function automatizacionPermitida(
  estado: ConversationState | null | undefined,
  planKey: string | null | undefined,
): boolean {
  if (estado !== "HUMAN_HANDOFF") return true;
  return esMomentoOperativo(planKey);
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

/**
 * Al cerrar la atencion, ¿desde cuando puede volver a salir lo comercial?
 *
 * Desde el momento del cierre, nunca hacia atras. Reanudar y recibir de golpe
 * el seguimiento de anteayer convierte el cierre en una descarga de mensajes
 * viejos, que es exactamente lo que el handoff evitaba.
 */
export function reanudarDesde(cerradoAt: Date): Date {
  return cerradoAt;
}
