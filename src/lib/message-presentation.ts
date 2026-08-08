import type { MessageStatus } from "@prisma/client";

/**
 * Traduccion de los estados internos al lenguaje de quien usa el panel.
 *
 * El sistema distingue once estados porque los necesita para decidir que
 * hacer. Quien mira la pantalla solo necesita cinco respuestas: ¿va a salir?,
 * ¿ya salio?, ¿llego?, ¿fallo?, ¿fue una prueba? Mostrar los once obliga a
 * aprender vocabulario del sistema para leer una tabla.
 *
 * El estado interno no se pierde: aparece junto al humano cuando el perfil
 * tecnico enciende el detalle.
 */
export type HumanStatusTone = "waiting" | "blocked" | "sent" | "done" | "problem" | "test";

export type HumanStatus = {
  label: string;
  tone: HumanStatusTone;
  /** Explicacion corta. Nunca contiene codigos ni vocabulario del sistema. */
  hint: string;
};

const MAP: Record<MessageStatus, HumanStatus> = {
  PROGRAMADO: { label: "Programado", tone: "waiting", hint: "Todavía no ha salido; saldrá a la hora prevista." },
  ENVIANDO: { label: "Saliendo", tone: "sent", hint: "Se está enviando en este momento." },
  ACEPTADO: { label: "Enviado", tone: "sent", hint: "El proveedor lo aceptó y lo está entregando." },
  ENVIADO: { label: "Enviado", tone: "sent", hint: "Salió correctamente." },
  ENTREGADO: { label: "Recibido", tone: "done", hint: "Llegó al destinatario." },
  LEIDO: { label: "Leído", tone: "done", hint: "El destinatario lo abrió." },
  REBOTADO: { label: "No llegó", tone: "problem", hint: "La dirección rechazó el mensaje." },
  FALLIDO: { label: "No salió", tone: "problem", hint: "Hubo un problema al enviarlo." },
  // OMITIDO no se traduce solo: un mensaje futuro al que le falta un dato no
  // ha fallado, nadie lo ha intentado todavia. Ver `humanStatusFor`.
  OMITIDO: { label: "Requiere configuración", tone: "blocked", hint: "Falta un dato para poder enviarlo." },
  CANCELADO: { label: "Cancelado", tone: "problem", hint: "Se canceló antes de salir." },
  SIMULADO: { label: "Prueba", tone: "test", hint: "Prueba interna: nadie lo recibió." },
};

export function humanStatus(status: MessageStatus): HumanStatus {
  return MAP[status] ?? { label: "Desconocido", tone: "waiting", hint: "" };
}

/**
 * Estado humano teniendo en cuenta CUANDO deberia salir el mensaje.
 *
 * Un OMITIDO cuya hora todavia no ha llegado no es un envio fallido: es una
 * comunicacion futura que no puede prepararse porque falta un dato. Contarlo
 * entre los fallos alarma sin motivo y esconde los fallos de verdad.
 *
 * Si la hora ya paso, entonces si es una oportunidad perdida y se dice asi.
 */
export function humanStatusFor(
  status: MessageStatus,
  scheduledAt: Date | string | null | undefined,
  now = new Date(),
): HumanStatus {
  if (status !== "OMITIDO") return humanStatus(status);
  const fecha = typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt;
  const futuro = fecha instanceof Date && !Number.isNaN(fecha.getTime()) && fecha.getTime() > now.getTime();
  return futuro
    ? { label: "Requiere configuración", tone: "blocked", hint: "Todavía no le toca salir, pero falta un dato para poder prepararlo." }
    : { label: "No se envió", tone: "problem", hint: "Le tocaba salir pero faltaba un dato, así que no se intentó." };
}

/** ¿Este mensaje representa un fallo real del proveedor? */
export function isRealFailure(status: MessageStatus, scheduledAt: Date | string | null | undefined, now = new Date()): boolean {
  if (status === "FALLIDO" || status === "REBOTADO") return true;
  if (status !== "OMITIDO") return false;
  return humanStatusFor(status, scheduledAt, now).tone === "problem";
}

/** Clase del punto de color que acompaña al estado. */
export function statusDotClass(status: MessageStatus, scheduledAt?: Date | string | null): string {
  return `status-dot is-${humanStatusFor(status, scheduledAt).tone}`;
}

/**
 * Motivos tecnicos traducidos.
 *
 * Un codigo como MISSING_STREAM_URL no le dice nada a quien tiene que
 * arreglarlo, y peor: no dice donde. Cada mensaje de aqui nombra el dato que
 * falta y, cuando existe, el sitio donde se pone.
 */
const REASONS: Record<string, string> = {
  MISSING_STREAM_URL: "Falta el enlace de la reunión. Se agrega en la ficha del curso, pestaña Sesiones.",
  WHATSAPP_TEMPLATE_MISSING: "Falta asignar la plantilla aprobada de WhatsApp a esta automatización.",
  CONTACT_EXCLUDED: "El contacto no tiene consentimiento registrado o está marcado como prueba.",
  SESSION_REMOVED: "La sesión a la que correspondía este aviso se eliminó del calendario.",
  CONTACT_ARCHIVED: "El contacto fue archivado, así que se detuvieron sus avisos pendientes.",
  BEFORE_LIVE_FROM: "Se programó antes de la fecha desde la que el canal puede enviar. No saldrá solo.",
  WHATSAPP_DISABLED: "El canal de WhatsApp está apagado.",
  WHATSAPP_CREDENTIALS_MISSING: "Faltan los datos de conexión de WhatsApp.",
  LIVE_FROM_MISSING: "El canal está en modo real pero sin fecha de activación, así que no envía nada.",
  LIVE_FROM_INVALID: "La fecha de activación del canal no es válida, así que el canal está detenido.",
  EAUTH: "El servidor de correo rechazó el usuario o la contraseña.",
  ETIMEDOUT: "El servidor de correo no respondió a tiempo.",
  NETWORK_ERROR: "No se pudo conectar con el proveedor.",
  INVALID_JSON: "El proveedor respondió algo que no se pudo interpretar.",
  MISSING_PROVIDER_ID: "El proveedor no confirmó la recepción del mensaje.",
};

/**
 * Motivo legible de un fallo. Si no se reconoce el codigo se devuelve el
 * mensaje que ya venia del proveedor, que suele ser mas util que el codigo.
 */
export function humanReason(errorCode: string | null, errorMessage: string | null): string | null {
  if (errorCode && REASONS[errorCode]) return REASONS[errorCode];
  // Los codigos de WhatsApp y de correo ya llegan traducidos desde el adaptador.
  if (errorMessage?.trim()) return errorMessage.trim();
  if (errorCode) return "No se pudo completar el envío. Revisa el detalle técnico.";
  return null;
}

/** Fecha y hora en Ecuador, en el formato que se lee de un vistazo. */
const guayaquil = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });
const guayaquilCorto = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
const guayaquilHora = new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" });

export function formatMoment(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : guayaquil.format(date);
}

export function formatDay(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : guayaquilCorto.format(date);
}

export function formatTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : guayaquilHora.format(date);
}

/** "hace 2 h", "en 3 días": mas legible que una marca de tiempo absoluta. */
export function relativeMoment(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const minuto = 60_000;
  const hora = 60 * minuto;
  const dia = 24 * hora;
  const formatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (abs < hora) return formatter.format(Math.round(diff / minuto), "minute");
  if (abs < dia) return formatter.format(Math.round(diff / hora), "hour");
  if (abs < 30 * dia) return formatter.format(Math.round(diff / dia), "day");
  return guayaquil.format(date);
}
