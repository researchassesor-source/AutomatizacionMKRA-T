/**
 * Plantillas de WhatsApp del plan estandar.
 *
 * Meta solo permite iniciar una conversacion con una plantilla aprobada. La
 * "ventana de servicio" de 24 horas se abre unicamente cuando el contacto
 * escribe primero, y ninguno de nuestros cinco mensajes ocurre despues de eso:
 * los cinco los inicia la empresa. Por tanto los cinco necesitan plantilla, sin
 * excepcion, y el adaptador debe negarse a enviar texto libre en su lugar.
 *
 * Los nombres de aqui son los que hay que dar de alta en Meta tal cual. Meta
 * exige minusculas, numeros y guiones bajos.
 */
export type WhatsAppTemplateSpec = {
  /** Nombre exacto que se registra en Meta. */
  name: string;
  language: string;
  /**
   * Orden EXACTO de las variables del cuerpo. El elemento 0 alimenta {{1}}.
   * Son claves de TEMPLATE_VARIABLES del motor, no textos ya resueltos.
   */
  bodyVars: string[];
  /**
   * Variable que rellena el sufijo del boton de URL dinamica, si la plantilla
   * declara uno. Nuestras plantillas no lo usan: ver la nota de abajo.
   */
  urlVar?: string;
  /** Texto de referencia que hay que registrar en Meta. */
  sample: string;
};

/**
 * Por que el enlace va en el cuerpo y no en un boton de URL dinamica.
 *
 * Un boton de URL dinamica fija el prefijo en la plantilla y solo admite un
 * sufijo variable (`https://ejemplo.com/{{1}}`). Nuestros enlaces de sesion
 * son de dominios ajenos y arbitrarios (Meet, Zoom, Teams), asi que ningun
 * prefijo fijo sirve. Un parametro de cuerpo si admite la URL completa.
 *
 * El soporte de boton existe en el codigo y esta probado, para plantillas
 * futuras que si tengan un prefijo propio; simplemente estas cinco no lo usan.
 */
export const WHATSAPP_TEMPLATES: Record<
  "welcome" | "reminder_24h" | "reminder_2h" | "reminder_15m" | "thank_you",
  WhatsAppTemplateSpec
> = {
  welcome: {
    name: "ra_training_bienvenida_inscripcion",
    language: "es",
    bodyVars: ["nombre", "curso", "fecha", "hora"],
    sample: "Hola {{1}}, tu inscripción a {{2}} quedó registrada. Fecha: {{3}}. Hora: {{4}}. Te avisaremos antes de cada sesión.",
  },
  reminder_24h: {
    name: "ra_training_recordatorio_24h",
    language: "es",
    bodyVars: ["nombre", "curso", "fechaSesion", "horaSesion"],
    sample: "Hola {{1}}, mañana tienes una sesión de {{2}}. Fecha: {{3}}. Hora: {{4}}. El enlace de acceso te llegará 2 horas antes.",
  },
  reminder_2h: {
    name: "ra_training_acceso_2h",
    language: "es",
    bodyVars: ["nombre", "curso", "horaSesion", "streamUrl"],
    sample: "Hola {{1}}, tu sesión de {{2}} comienza a las {{3}}. Este es tu enlace de acceso: {{4}}",
  },
  reminder_15m: {
    name: "ra_training_acceso_15min",
    language: "es",
    bodyVars: ["nombre", "curso", "streamUrl"],
    sample: "Hola {{1}}, la sesión de {{2}} empieza en 15 minutos. Ingresa aquí: {{3}}",
  },
  thank_you: {
    name: "ra_training_agradecimiento_final",
    language: "es",
    bodyVars: ["nombre", "curso"],
    sample: "¡Felicitaciones {{1}}! Completaste {{2}}. Gracias por acompañarnos.",
  },
};

export type WhatsAppTemplateKey = keyof typeof WHATSAPP_TEMPLATES;

export type TemplateBinding = {
  name: string;
  language: string;
  bodyVars: string[];
  urlVar?: string | null;
};

export type TemplateComponent =
  | { type: "body"; parameters: Array<{ type: "text"; text: string }> }
  | { type: "button"; sub_type: "url"; index: "0"; parameters: Array<{ type: "text"; text: string }> };

export type BuildTemplateResult =
  | { ok: true; components: TemplateComponent[] }
  | { ok: false; errorCode: string; error: string };

/**
 * Meta rechaza un parametro vacio, con salto de linea o con tabulaciones, y la
 * peticion entera falla. Comprobarlo aqui convierte un rechazo remoto opaco en
 * un motivo legible antes de gastar el intento.
 */
function invalidParameter(raw: string): string | null {
  if (!raw.trim()) return "está vacío";
  if (/[\n\r\t]/.test(raw)) return "contiene saltos de línea o tabulaciones";
  if (/ {5,}/.test(raw)) return "contiene demasiados espacios seguidos";
  return null;
}

/**
 * Construye los `components` a partir del enlace regla-plantilla y de las
 * variables ya resueltas. No adivina: si falta una variable o su valor no sirve,
 * devuelve el motivo en lugar de enviar algo que Meta rechazaria.
 */
export function buildTemplateComponents(
  binding: TemplateBinding,
  vars: Record<string, string>,
): BuildTemplateResult {
  const parameters: Array<{ type: "text"; text: string }> = [];
  for (const [index, key] of binding.bodyVars.entries()) {
    const raw = vars[key];
    if (raw === undefined) {
      return {
        ok: false,
        errorCode: "TEMPLATE_VARIABLE_MISSING",
        error: `La plantilla ${binding.name} espera la variable "${key}" en la posición {{${index + 1}}}, y el mensaje no la tiene.`,
      };
    }
    const problem = invalidParameter(raw);
    if (problem) {
      return {
        ok: false,
        errorCode: "TEMPLATE_VARIABLE_INVALID",
        error: `El valor de "${key}" para la plantilla ${binding.name} ${problem}. WhatsApp rechazaría el mensaje.`,
      };
    }
    parameters.push({ type: "text", text: raw.trim() });
  }

  const components: TemplateComponent[] = [];
  if (parameters.length > 0) components.push({ type: "body", parameters });

  if (binding.urlVar) {
    const raw = vars[binding.urlVar];
    const problem = raw === undefined ? "no está definida" : invalidParameter(raw);
    if (problem) {
      return {
        ok: false,
        errorCode: "TEMPLATE_BUTTON_INVALID",
        error: `El botón de URL de la plantilla ${binding.name} usa "${binding.urlVar}", cuyo valor ${problem}.`,
      };
    }
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: raw.trim() }] });
  }

  return { ok: true, components };
}

/** Lectura tolerante de `waTemplateBodyVars`, que en la base es JSON libre. */
export function parseBodyVars(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export type RuleTemplateFields = {
  waTemplateName: string | null;
  waTemplateLanguage: string | null;
  waTemplateBodyVars: unknown;
  waTemplateUrlVar: string | null;
};

/**
 * Enlace regla-plantilla, o `null` si la regla no declara ninguna.
 *
 * Devolver `null` no es un detalle menor: es lo que el motor usa para negarse a
 * enviar una regla de WhatsApp sin plantilla, en lugar de caer en texto libre.
 */
export function templateBindingOf(rule: RuleTemplateFields): TemplateBinding | null {
  const name = rule.waTemplateName?.trim();
  if (!name) return null;
  return {
    name,
    language: rule.waTemplateLanguage?.trim() || "es",
    bodyVars: parseBodyVars(rule.waTemplateBodyVars),
    urlVar: rule.waTemplateUrlVar?.trim() || null,
  };
}
