/**
 * Codigos del backend traducidos a algo que se pueda leer.
 *
 * Un codigo tecnico en pantalla obliga a quien atiende a preguntar que
 * significa, y mientras tanto el contacto sigue esperando. Cada texto dice ya
 * cual es el siguiente paso.
 */
const MENSAJES: Record<string, string> = {
  CONVERSATION_NOT_LINKED: "Vincula esta conversación a un contacto antes de responder.",
  WINDOW_CLOSED_TEMPLATE_REQUIRED: "WhatsApp cerró la ventana de atención. Usa una plantilla aprobada.",
  TEMPLATE_UNKNOWN: "Esa plantilla no está en el catálogo aprobado.",
  TEMPLATE_CAMPAIGN_ONLY: "Esa plantilla solo se envía desde una campaña institucional.",
  TEMPLATE_CONTEXT_MISSING: "Faltan datos del curso para armar la plantilla. Elige una inscripción o completa la configuración del curso.",
  CONTEXT_FOREIGN: "El mensaje citado no pertenece a esta conversación.",
  ENROLLMENT_MISMATCH: "Esa inscripción no es de este contacto.",
  PHONE_MISMATCH: "El número del contacto no coincide con esta conversación.",
  LEAD_NOT_FOUND: "Ese contacto ya no existe.",
  ADMIN_INVALID: "Ese usuario no existe o está inactivo.",
  CHANNEL_SIMULATION: "El canal está en simulación: no se envió nada.",
  CHANNEL_BLOCKED: "El canal de WhatsApp está bloqueado. Revisa su configuración.",
  TEXT_EMPTY: "Escribe un mensaje antes de enviar.",
};

export function mensajeDeError(codigo: string | null | undefined, respaldo?: string | null): string {
  if (codigo && MENSAJES[codigo]) return MENSAJES[codigo];
  // El texto del backend ya viene redactado para leerse; el generico es el
  // ultimo recurso, no la norma.
  return respaldo?.trim() || "No se pudo completar la acción. Vuelve a intentarlo.";
}

/** Etiqueta de un adjunto, sin prometer una vista previa que no existe. */
export function etiquetaDeTipo(tipo: string, adjunto: Record<string, unknown> | null): string {
  const nombre = typeof adjunto?.filename === "string" ? adjunto.filename : null;
  switch (tipo) {
    case "image": return "Imagen";
    case "document": return nombre ? `Documento · ${nombre}` : "Documento";
    case "audio": return "Audio";
    case "video": return "Video";
    case "sticker": return "Sticker";
    case "location": {
      const lugar = typeof adjunto?.name === "string" ? adjunto.name : null;
      return lugar ? `Ubicación · ${lugar}` : "Ubicación";
    }
    case "contacts": return "Contacto compartido";
    case "reaction": return "Reacción";
    case "interactive":
    case "button": return "Respuesta a un botón";
    case "text": return "";
    default: return "Mensaje no compatible";
  }
}

/** Estado de un saliente, en palabras. */
export function etiquetaDeEstado(estado: string | null): string {
  switch (estado) {
    case "ENVIANDO": return "Enviando…";
    case "ACEPTADO":
    case "ENVIADO": return "Enviado";
    case "ENTREGADO": return "Entregado";
    case "LEIDO": return "Leído";
    case "FALLIDO": return "No se pudo enviar";
    case "OMITIDO": return "Omitido";
    case "CANCELADO": return "Cancelado";
    case "SIMULADO": return "Simulado";
    case "PROGRAMADO": return "Programado";
    default: return "";
  }
}
