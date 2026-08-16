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
  /**
   * Cuerpo final que debe registrarse en Meta, con sus saltos de linea y su
   * firma. No es una aproximacion ni un resumen.
   *
   * Es lo que ve quien revisa una plantilla desde el panel, asi que si aqui
   * dice una cosa y Meta envia otra, el CRM esta enseñando un mensaje que
   * nadie recibio. Cualquier cambio se somete a revision en Meta antes de
   * activar el canal; la prueba de contrato fija literalmente el texto final.
  */
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
  | "welcome"
  | "whatsapp_group"
  | "reminder_24h"
  | "reminder_2h"
  | "reminder_15m"
  | "session_live"
  | "late_access"
  | "thank_you"
  | "course_complete"
  | "course_follow_up"
  | "survey"
  | "certification_offer",
  WhatsAppTemplateSpec
> = {
  welcome: {
    name: "ra_training_bienvenida_inscripcion",
    language: "es",
    bodyVars: ["nombre", "curso", "fecha", "hora"],
    sample: "👋 Hola {{1}}, ¡tu inscripción está registrada! ✅\n\nTe esperamos en {{2}}.\n📅 Fecha: {{3}}\n🕒 Hora: {{4}}\n\nPor este número recibirás los recordatorios y enlaces necesarios para participar en tu curso. 📚\n\nEste es un canal automático de información. Si respondes a este chat, te indicaremos cómo comunicarte con nuestro equipo de atención.\n\nR.A. Training 💙",
  },
  whatsapp_group: {
    name: "ra_training_grupo_whatsapp",
    language: "es",
    bodyVars: ["nombre", "curso", "link_grupo_whatsapp"],
    sample: "Hola {{1}}, tu registro a {{2}} esta confirmado.\n\nGrupo oficial de WhatsApp:\n{{3}}\n\nR.A. Training",
  },
  reminder_24h: {
    name: "ra_training_recordatorio_24h",
    language: "es",
    bodyVars: ["nombre", "curso", "fechaSesion", "horaSesion"],
    sample: "⏰ Hola {{1}}, te recordamos que mañana tienes tu sesión de {{2}}.\n\n📅 Fecha: {{3}}\n🕒 Hora: {{4}}\n\nTe recomendamos tener listo tu dispositivo y una conexión estable para ingresar sin inconvenientes.\n\nPor este número seguiremos enviándote la información necesaria para tu sesión.\n\nR.A. Training 📚",
  },
  reminder_2h: {
    name: "ra_training_acceso_2h",
    language: "es",
    bodyVars: ["nombre", "curso", "horaSesion", "streamUrl"],
    sample: "🎓 Hola {{1}}, tu sesión de {{2}} comienza en aproximadamente 2 horas.\n\n🕒 Hora: {{3}}\n🔗 Enlace de acceso: {{4}}\n\nGuarda este enlace y procura ingresar unos minutos antes del inicio de la sesión.\n\n¡Nos vemos pronto!\nR.A. Training 💙",
  },
  reminder_15m: {
    name: "ra_training_acceso_15min",
    language: "es",
    // Cuatro variables, igual que la plantilla registrada en Meta. Declarar
    // tres producia el error 132000 ("numero de parametros incorrecto") en el
    // primer envio real, que es justo donde no conviene descubrirlo.
    bodyVars: ["nombre", "curso", "horaSesion", "streamUrl"],
    sample: "🚀 Hola {{1}}, ¡ya casi comenzamos!\n\nTu sesión de {{2}} inicia en 15 minutos.\n\n🕒 Hora: {{3}}\n🔗 Ingresa aquí: {{4}}\n\nTe recomendamos conectarte desde ahora para estar listo al comenzar.\n\nR.A. Training 📚",
  },
  thank_you: {
    name: "ra_training_agradecimiento_final",
    language: "es",
    bodyVars: ["nombre", "curso"],
    sample: "✅ Hola {{1}}, hemos finalizado {{2}}.\n\nGracias por acompañarnos y ser parte de esta capacitación. Esperamos que lo aprendido sea de utilidad para ti. 📚\n\nSi necesitas ayuda o tienes alguna consulta, puedes responder a este chat y te indicaremos cómo comunicarte con nuestro equipo.\n\nGracias por confiar en R.A. Training. 💙",
  },
  session_live: {
    name: "ra_training_sesion_en_vivo",
    language: "es",
    bodyVars: ["nombre", "curso", "sesion_actual", "link_reunion"],
    sample: "Hola {{1}}, {{3}} de {{2}} ya esta comenzando.\n\nIngresa aqui: {{4}}\n\nR.A. Training",
  },
  late_access: {
    name: "ra_training_acceso_rezagados",
    language: "es",
    bodyVars: ["nombre", "curso", "sesion_actual", "link_reunion"],
    sample: "Hola {{1}}, si aun no ingresaste a {{3}} de {{2}}, puedes usar este enlace:\n\n{{4}}\n\nR.A. Training",
  },
  course_complete: {
    name: "ra_training_curso_completo",
    language: "es",
    bodyVars: ["nombre", "curso", "link_curso_completo"],
    sample: "Hola {{1}}, puedes revisar la informacion completa de {{2}} aqui:\n\n{{3}}\n\nR.A. Training",
  },
  course_follow_up: {
    name: "ra_training_seguimiento_curso",
    language: "es",
    bodyVars: ["nombre", "curso"],
    sample: "Hola {{1}}, gracias nuevamente por participar en {{2}}.\n\nSi necesitas apoyo adicional, responde a este chat y te orientaremos.\n\nR.A. Training",
  },
  survey: {
    name: "ra_training_encuesta",
    language: "es",
    bodyVars: ["nombre", "curso", "link_encuesta"],
    sample: "Hola {{1}}, tu opinion nos ayuda a mejorar.\n\nCompleta la encuesta final de {{2}} aqui:\n\n{{3}}\n\nGracias por confiar en R.A. Training.",
  },
  /**
   * Oferta de certificacion institucional.
   *
   * NO forma parte del plan de once mensajes: es una campaña comercial aparte,
   * con su propia audiencia y su propio calendario. Vive en este catalogo
   * porque comparte el adaptador de WhatsApp, no porque comparta el flujo, y
   * por eso no aparece en WHATSAPP_AUTOMATION_PLAN.
   */
  certification_offer: {
    name: "ra_training_certificacion_institucional",
    language: "es",
    bodyVars: ["nombre", "curso", "link_oferta_institucional"],
    sample: "Hola {{1}}, ya puedes obtener tu certificado institucional de {{2}}.\n\nAccede al curso completo de 60 horas y a tu certificado R.A. Training aqui:\n\n{{3}}\n\nR.A. Training",
  },
};

export type WhatsAppTemplateKey = keyof typeof WHATSAPP_TEMPLATES;

/**
 * Sustituye {{1}}, {{2}}… por los valores que ocupan esa posicion.
 *
 * `resolver` recibe el nombre de la variable de esa posicion y devuelve con que
 * rellenarla. Con valores de ejemplo produce el mensaje tal como lo recibiria
 * un contacto; con `(nombre) => "{{" + nombre + "}}"` produce la version con
 * marcadores que entiende el motor de plantillas del CRM.
 *
 * Un {{n}} fuera del rango de variables se deja intacto en lugar de borrarse:
 * si el texto y `bodyVars` alguna vez discrepan, conviene que se vea.
 */
export function fillTemplateBody(spec: WhatsAppTemplateSpec, resolver: (variable: string, index: number) => string): string {
  return spec.sample.replace(/\{\{(\d+)\}\}/g, (original, posicion: string) => {
    const index = Number(posicion) - 1;
    const variable = spec.bodyVars[index];
    return variable === undefined ? original : resolver(variable, index);
  });
}

/**
 * El texto registrado en Meta, con marcadores del motor en vez de numeros.
 *
 * Es lo que se guarda como cuerpo legible del mensaje. Derivarlo del mismo
 * `sample` en lugar de escribirlo aparte evita el problema que motivo este
 * cambio: dos textos que dicen ser el mismo mensaje y no lo son.
 */
export function templateBodyWithPlaceholders(spec: WhatsAppTemplateSpec): string {
  return fillTemplateBody(spec, (variable) => `{{${variable}}}`);
}

/** Indice por el nombre exacto con el que la plantilla esta dada de alta en Meta. */
const BY_META_NAME = new Map<string, WhatsAppTemplateSpec>(
  Object.values(WHATSAPP_TEMPLATES).map((spec) => [spec.name, spec]),
);

/**
 * Ficha del catalogo para un nombre registrado en Meta, o `null` si el nombre
 * no es de las cinco plantillas del plan (por ejemplo una dada de alta a mano).
 */
export function canonicalTemplate(name: string): WhatsAppTemplateSpec | null {
  return BY_META_NAME.get(name.trim()) ?? null;
}

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

  /**
   * Cuando el nombre es una de las cinco plantillas del plan, manda el
   * catalogo del codigo y no la copia guardada en la regla.
   *
   * La regla guarda una copia de las variables el dia que se creo. Si mas
   * tarde se corrige el catalogo —por ejemplo porque la plantilla registrada
   * en Meta tenia cuatro variables y aqui figuraban tres— las reglas ya
   * existentes seguirian mandando el numero viejo, y Meta responde 132000
   * ("numero de parametros incorrecto"): el fallo aparece en el primer envio
   * real, que es el peor sitio posible para descubrirlo. El catalogo es lo que
   * esta bajo pruebas y lo que se compara con el alta en Meta, asi que es la
   * fuente de verdad; la fila es cache.
   *
   * Las plantillas ajenas al plan conservan lo que diga la regla: de esas el
   * codigo no sabe nada y sobrescribirlas seria inventar.
   */
  const canonical = canonicalTemplate(name);
  if (canonical) {
    return {
      name: canonical.name,
      language: canonical.language,
      bodyVars: [...canonical.bodyVars],
      urlVar: canonical.urlVar ?? null,
    };
  }

  return {
    name,
    language: rule.waTemplateLanguage?.trim() || "es",
    bodyVars: parseBodyVars(rule.waTemplateBodyVars),
    urlVar: rule.waTemplateUrlVar?.trim() || null,
  };
}
