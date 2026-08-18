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
   * Categoria con la que se da de alta en Meta.
   *
   * No la elige el CRM: Meta cobra y enruta distinto un aviso de servicio que
   * una promocion, y registrar una plantilla comercial como UTILITY es motivo
   * de rechazo. Se declara aqui para que el registro manual en Meta no dependa
   * de recordarlo.
   */
  category: "UTILITY" | "MARKETING";
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
  | "session_complete"
  | "course_complete"
  | "course_follow_up"
  | "survey"
  | "certification_offer",
  WhatsAppTemplateSpec
> = {
  welcome: {
    name: "ra_training_bienvenida_inscripcion",
    language: "es",
    category: "UTILITY",
    bodyVars: ["nombre", "curso", "fechaSesion", "horaSesion", "numero_sesion", "total_sesiones"],
    sample: "👋 ¡Hola {{1}}! Tu inscripción está confirmada. ✅\n\nGracias por registrarte en:\n\n🎓 {{2}}\n\nTu capacitación iniciará con la Sesión {{5}} de {{6}}.\n\n📅 Fecha: {{3}}\n🕢 Hora: {{4}}\n💻 Modalidad: Online\n\nPor este medio recibirás los accesos, recordatorios e información necesaria para acompañarte durante tu aprendizaje.\n\n¡Nos vemos pronto! 🚀\n\nR.A. Training 💙\nCapacitación que transforma.",
  },
  whatsapp_group: {
    name: "ra_training_grupo_whatsapp",
    language: "es",
    category: "MARKETING",
    // Sin nombre: el mensaje se dirige a la comunidad, no a la persona.
    bodyVars: ["curso", "link_grupo_whatsapp"],
    sample: "👥 ¡Ya eres parte de nuestra comunidad de aprendizaje!\n\nPara acompañarte durante tu proceso y recibir información relacionada con tu capacitación:\n\n🎓 {{1}}\n\nÚnete al grupo oficial de WhatsApp:\n\n👉 {{2}}\n\nEn este espacio compartiremos información importante antes y durante cada sesión.\n\n¡Te esperamos! 🚀\n\nR.A. Training 💙",
  },
  reminder_24h: {
    name: "ra_training_recordatorio_24h",
    language: "es",
    category: "UTILITY",
    bodyVars: ["nombre", "curso", "numero_sesion", "total_sesiones", "fechaSesion", "horaSesion"],
    sample: "⏰ ¡Mañana continuamos aprendiendo!\n\nHola {{1}} 👋\n\nTe recordamos que mañana tenemos la:\n\n📚 Sesión {{3}} de {{4}}\n\nDel curso:\n\n🎓 {{2}}\n\n📅 Fecha:\n{{5}}\n\n🕢 Hora:\n{{6}}\n\nPrepara tus preguntas y acompáñanos en esta nueva sesión.\n\n¡Nos vemos pronto! 🚀\n\nR.A. Training 💙",
  },
  reminder_2h: {
    name: "ra_training_acceso_2h",
    language: "es",
    category: "UTILITY",
    bodyVars: ["nombre", "curso", "numero_sesion", "total_sesiones", "horaSesion"],
    sample: "🚀 ¡Faltan 2 horas para comenzar!\n\nHola {{1}} 👋\n\nHoy tenemos la:\n\n📚 Sesión {{3}} de {{4}}\n\nDel curso:\n\n🎓 {{2}}\n\nRecuerda tener listo:\n\n✅ Tu conexión a internet\n✅ Tu dispositivo\n✅ Tus preguntas\n\nNos vemos a las:\n\n🕢 {{5}}\n\n¡Prepárate para aprender! 💙\n\nR.A. Training",
  },
  reminder_15m: {
    name: "ra_training_acceso_15min",
    language: "es",
    category: "UTILITY",
    bodyVars: ["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"],
    sample: "🚀 ¡Comenzamos en 15 minutos!\n\nHola {{1}} 👋\n\nTu:\n\n📚 Sesión {{3}} de {{4}}\n\nDel curso:\n\n🎓 {{2}}\n\nestá por iniciar.\n\nIngresa aquí:\n\n👉 {{5}}\n\nTe esperamos dentro.\n\n¡Que empiece el aprendizaje! 💙\n\nR.A. Training",
  },
  /**
   * Cierre de CADA sesion, no del curso.
   *
   * Sustituye al antiguo `thank_you` / `ra_training_agradecimiento_final`, que
   * agradecia al terminar sin decir que venia despues. Este anuncia la
   * siguiente sesion, y por eso solo se programa cuando existe una: ver
   * `scheduleTargets`.
   */
  session_complete: {
    name: "ra_training_fin_sesion",
    language: "es",
    category: "UTILITY",
    bodyVars: ["nombre", "curso", "numero_sesion", "total_sesiones", "proxima_sesion"],
    sample: "✅ ¡Sesión completada!\n\nHola {{1}} 👋\n\nGracias por acompañarnos en la:\n\n📚 Sesión {{3}} de {{4}}\n\nDel curso:\n\n🎓 {{2}}\n\nEsperamos que esta experiencia haya sido útil para tu aprendizaje.\n\nRecuerda que continuaremos con:\n\n📅 {{5}}\n\n¡Nos vemos pronto! 🚀\n\nR.A. Training 💙",
  },
  session_live: {
    name: "ra_training_sesion_en_vivo",
    language: "es",
    category: "UTILITY",
    bodyVars: ["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"],
    sample: "🔴 ¡Ya estamos en vivo!\n\nHola {{1}} 👋\n\nLa Sesión {{3}} de {{4}} del curso:\n\n🎓 {{2}}\n\nacaba de comenzar.\n\nPuedes ingresar ahora:\n\n👉 {{5}}\n\n¡Te esperamos dentro! 🚀\n\nR.A. Training 💙",
  },
  late_access: {
    name: "ra_training_acceso_rezagados",
    language: "es",
    category: "UTILITY",
    // Sin total: quien llega tarde necesita entrar, no situarse en el curso.
    bodyVars: ["nombre", "curso", "numero_sesion", "streamUrl"],
    sample: "👋 {{1}}, todavía puedes unirte.\n\nLa Sesión {{3}} del curso:\n\n🎓 {{2}}\n\nya comenzó, pero aún puedes ingresar.\n\nAccede aquí:\n\n👉 {{4}}\n\nTe esperamos para continuar aprendiendo. 🚀\n\nR.A. Training",
  },
  course_complete: {
    name: "ra_training_curso_completo",
    language: "es",
    category: "MARKETING",
    bodyVars: ["nombre", "curso", "link_curso_completo"],
    sample: "🚀 ¡Continúa tu aprendizaje!\n\nHola {{1}} 👋\n\nLa capacitación gratuita fue el primer paso.\n\nAhora puedes profundizar tus conocimientos con:\n\n🎓 {{2}}\n\nUna formación completa con:\n\n✅ Clases especializadas\n✅ Actividades prácticas\n✅ Recursos de aprendizaje\n✅ Certificación del programa\n\nConoce todos los detalles aquí:\n\n👉 {{3}}\n\nSigue desarrollando nuevas habilidades junto a R.A. Training 💙",
  },
  course_follow_up: {
    name: "ra_training_seguimiento_curso",
    language: "es",
    category: "MARKETING",
    bodyVars: ["nombre", "curso", "link_curso_completo"],
    sample: "👋 Hola {{1}}.\n\nQueríamos saber si pudiste revisar la información del programa:\n\n🎓 {{2}}\n\nEsta formación está diseñada para quienes quieren aprender Inteligencia Artificial de manera práctica y aplicada.\n\nSi tienes alguna duda, estaremos encantados de ayudarte.\n\nPuedes revisar todos los detalles aquí:\n\n👉 {{3}}\n\n¡Esperamos verte dentro! 🚀\n\nR.A. Training",
  },
  survey: {
    name: "ra_training_encuesta_experiencia",
    language: "es",
    category: "MARKETING",
    bodyVars: ["nombre", "curso", "link_encuesta"],
    sample: "⭐ Queremos conocer tu experiencia.\n\nHola {{1}} 👋\n\nGracias por formar parte de:\n\n🎓 {{2}}\n\nTu opinión nos ayuda a mejorar nuestras próximas capacitaciones.\n\nCuéntanos cómo fue tu experiencia:\n\n👉 {{3}}\n\nGracias por aprender junto a R.A. Training 💙",
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
    category: "MARKETING",
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
