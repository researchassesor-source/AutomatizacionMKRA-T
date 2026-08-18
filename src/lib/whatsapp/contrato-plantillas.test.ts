import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTemplateComponents, canonicalTemplate, templateBindingOf, WHATSAPP_TEMPLATES, type WhatsAppTemplateSpec } from "./templates";
import { WHATSAPP_AUTOMATION_PLAN } from "@/lib/nurture/default-automations-whatsapp";

/**
 * Contrato de las doce plantillas frente a Meta.
 *
 * Meta valida por posicion, no por nombre: si el catalogo declara cuatro
 * variables y la plantilla registrada espera seis, la peticion falla entera con
 * 132000 y el contacto no recibe nada. Eso ya paso con la bienvenida y solo se
 * vio en el envio, que es el peor sitio para descubrirlo.
 *
 * Los textos de aqui son una copia tomada del panel de Meta, no del catalogo:
 * si se derivaran del codigo, esta prueba confirmaria cualquier cosa que el
 * codigo dijera en lugar de comprobarla.
 */
type Esperado = { key: keyof typeof WHATSAPP_TEMPLATES; name: string; vars: string[]; texto: string };

const JOURNEY: Esperado[] = [
  {
    key: "welcome",
    name: "ra_training_bienvenida_inscripcion",
    vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "fechaSesion", "horaSesion"],
    texto: "👋 ¡Hola {{1}}! Tu inscripción está confirmada. ✅\n\nGracias por registrarte en:\n\n🎓 {{2}}\n\nTu participación corresponde a la Sesión {{3}} de {{4}}.\n\n📅 Fecha: {{5}}\n🕒 Hora: {{6}}\n💻 Modalidad: Online\n\nPor este medio recibirás los recordatorios, accesos y novedades importantes para acompañarte durante tu capacitación. 🚀\n\n¡Nos vemos pronto!\n\nR.A. Training 💙\nCapacitación que transforma.",
  },
  {
    key: "whatsapp_group",
    name: "ra_training_grupo_whatsapp",
    vars: ["curso", "link_grupo_whatsapp"],
    texto: "👥 ¡Ya eres parte de nuestra comunidad de aprendizaje!\n\nPara acompañarte durante tu proceso y recibir información relacionada con tu capacitación:\n\n🎓 {{1}}\n\nÚnete al grupo oficial de WhatsApp:\n\n👉 {{2}}\n\nEn este espacio compartiremos información importante antes y durante cada sesión.\n\n¡Te esperamos! 🚀\n\nR.A. Training 💙",
  },
  {
    key: "reminder_24h",
    name: "ra_training_recordatorio_24h",
    vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "fechaSesion", "horaSesion"],
    texto: "⏰ ¡Mañana continuamos aprendiendo!\n\nHola {{1}} 👋\n\nTe recordamos que mañana tenemos la:\n\n📚 Sesión {{3}} de {{4}}\n\nDel curso:\n\n🎓 {{2}}\n\n📅 Fecha:\n{{5}}\n\n🕒 Hora:\n{{6}}\n\nPrepara tus preguntas y acompáñanos en esta nueva sesión.\n\n¡Nos vemos pronto! 🚀\n\nR.A. Training 💙",
  },
  {
    key: "reminder_2h",
    name: "ra_training_acceso_2h",
    vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "horaSesion"],
    texto: "🚀 ¡Faltan 2 horas para comenzar!\n\nHola {{1}} 👋\n\nHoy tenemos la:\n\n📚 Sesión {{3}} de {{4}}\n\nDel curso:\n\n🎓 {{2}}\n\nRecuerda tener listo:\n\n✅ Tu conexión a internet\n✅ Tu dispositivo\n✅ Tus preguntas\n\nNos vemos a las:\n\n🕒 {{5}}\n\n¡Prepárate para aprender! 💙\n\nR.A. Training",
  },
  {
    key: "reminder_15m",
    name: "ra_training_acceso_15min",
    vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"],
    texto: "🚀 ¡Comenzamos en 15 minutos!\n\nHola {{1}} 👋\n\nTu:\n\n📚 Sesión {{3}} de {{4}}\n\nDel curso:\n\n🎓 {{2}}\n\nestá por iniciar.\n\nIngresa aquí:\n\n👉 {{5}}\n\nTe esperamos dentro.\n\n¡Que empiece el aprendizaje! 💙\n\nR.A. Training",
  },
  {
    key: "session_live",
    name: "ra_training_sesion_en_vivo",
    vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"],
    texto: "🔴 ¡Tu sesión ya inició!\n\nHola {{1}} 👋\n\nLa Sesión {{3}} de {{4}} del curso:\n\n🎓 {{2}}\n\nya está disponible.\n\nPuedes ingresar desde aquí:\n\n👉 {{5}}\n\nAccede para continuar con tu capacitación.\n\nR.A. Training 💙",
  },
  {
    key: "late_access",
    name: "ra_training_acceso_rezagados",
    vars: ["nombre", "curso", "numero_sesion", "streamUrl"],
    texto: "👋 Hola {{1}}.\n\nTe informamos que la Sesión {{3}} del curso:\n\n🎓 {{2}}\n\nya inició.\n\nSi aún deseas incorporarte a la sesión, puedes ingresar desde el siguiente enlace:\n\n👉 {{4}}\n\nR.A. Training 💙",
  },
  {
    key: "thank_you",
    name: "ra_training_fin_sesion",
    vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "proxima_sesion"],
    texto: "✅ Sesión finalizada\n\nHola {{1}}.\n\nTe informamos que la Sesión {{3}} de {{4}} del curso:\n\n🎓 {{2}}\n\nha finalizado correctamente.\n\nLa siguiente sesión está programada para:\n\n📅 {{5}}\n\nRecibirás el acceso y recordatorios correspondientes antes del inicio.\n\nR.A. Training 💙",
  },
  {
    key: "course_complete",
    name: "ra_training_curso_completo",
    vars: ["nombre", "curso", "link_curso_completo"],
    texto: "🚀 ¡Continúa tu aprendizaje!\n\nHola {{1}} 👋\n\nSi disfrutaste esta capacitación gratuita, ahora puedes profundizar tus conocimientos con la versión completa del curso:\n\n🎓 {{2}}\n\nUna formación más amplia donde encontrarás:\n\n✅ Clases especializadas\n✅ Actividades prácticas\n✅ Recursos de aprendizaje\n✅ Certificación del programa\n\nContinúa desarrollando tus habilidades y aprende la Inteligencia Artificial de forma más completa junto a R.A. Training.\n\nConoce todos los detalles aquí:\n\n👉 {{3}}\n\nR.A. Training 💙\nCapacitación que transforma.",
  },
  {
    key: "course_follow_up",
    name: "ra_training_seguimiento_curso",
    vars: ["nombre", "curso", "link_curso_completo"],
    texto: "👋 Hola {{1}}.\n\nEsperamos que hayas disfrutado la capacitación gratuita y que hayas podido conocer el potencial de la Inteligencia Artificial.\n\nSi deseas seguir profundizando, puedes continuar tu formación con:\n\n🎓 {{2}}\n\nUna experiencia más completa con contenido práctico, actividades y herramientas para aplicar lo aprendido.\n\nSi tienes alguna duda sobre el programa, estamos para ayudarte. 💙\n\nConoce todos los detalles aquí:\n\n👉 {{3}}\n\nContinúa aprendiendo junto a R.A. Training 🚀",
  },
  {
    key: "survey",
    name: "ra_training_encuesta_experiencia",
    vars: ["nombre", "curso", "link_encuesta"],
    texto: "⭐ Queremos conocer tu experiencia.\n\nHola {{1}} 👋\n\nGracias por formar parte de:\n\n🎓 {{2}}\n\nTu opinión nos ayuda a mejorar nuestras próximas capacitaciones.\n\nCuéntanos cómo fue tu experiencia:\n\n👉 {{3}}\n\nGracias por aprender junto a R.A. Training 💙",
  },
];

/** Fuera del journey: campaña comercial con su propio calendario. */
const OFERTA: Esperado = {
  key: "certification_offer",
  name: "ra_training_certificacion_institucional",
  vars: ["nombre", "curso", "link_oferta_institucional"],
  texto: "🎓 Tenemos una oportunidad especial para ti, {{1}}.\n\nSi aún no continuaste con la versión completa de {{2}}, ahora puedes acceder a la formación completa y obtener tu certificado institucional de R.A. Training.\n\n✅ Acceso al curso completo de 60 horas\n✅ Recursos y actividades de aprendizaje\n✅ Certificado institucional R.A. Training\n\nValor especial: $10\n\nEsta modalidad incluye únicamente el certificado institucional y no incluye el certificado con aval externo.\n\n👉 Puedes revisar todos los detalles y continuar desde este enlace: {{3}}\n\nR.A. Training | Formación que impulsa tu desarrollo.",
};

const TODAS = [...JOURNEY, OFERTA];

function valoresDe(spec: WhatsAppTemplateSpec): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const clave of spec.bodyVars) vars[clave] = `valor-${clave}`;
  if (spec.urlVar) vars[spec.urlVar] = "https://ra-training.com/prueba";
  return vars;
}

describe.each(TODAS)("$key", (esperado) => {
  const spec = WHATSAPP_TEMPLATES[esperado.key];

  it("tiene el nombre exacto registrado en Meta", () => {
    expect(spec.name).toBe(esperado.name);
    expect(spec.name).toMatch(/^[a-z0-9_]+$/);
  });

  it("está en español", () => {
    expect(spec.language).toBe("es");
  });

  it("declara exactamente sus variables, en su orden", () => {
    expect(spec.bodyVars).toEqual(esperado.vars);
  });

  it("su texto coincide carácter a carácter con el registrado", () => {
    expect(spec.sample).toBe(esperado.texto);
  });

  it("usa {{1}}..{{n}} sin huecos ni repeticiones", () => {
    // Un salto (por ejemplo {{1}}, {{3}}) desplaza todo lo que va detras: el
    // contacto recibiria la hora donde esperaba la fecha.
    const usados = [...spec.sample.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect([...new Set(usados)].sort((a, b) => a - b)).toEqual(esperado.vars.map((_, i) => i + 1));
  });

  it("el payload lleva ese mismo número y orden de parámetros, sin ninguno vacío", () => {
    const construido = buildTemplateComponents(
      { name: spec.name, language: spec.language, bodyVars: [...spec.bodyVars], urlVar: spec.urlVar ?? null },
      valoresDe(spec),
    );
    expect(construido.ok, construido.ok ? "" : construido.error).toBe(true);
    if (!construido.ok) return;
    const body = construido.components.find((c) => c.type === "body");
    expect(body?.parameters).toHaveLength(esperado.vars.length);
    expect(body?.parameters.map((p) => p.text)).toEqual(esperado.vars.map((v) => `valor-${v}`));
    for (const parametro of body?.parameters ?? []) expect(parametro.text.trim()).not.toBe("");
  });

  it("no declara botón: ninguna de las doce lo usa", () => {
    // Los enlaces de sesion son de dominios ajenos, y un boton de URL dinamica
    // solo admite sufijo sobre un prefijo fijo.
    expect(spec.urlVar).toBeUndefined();
  });
});

describe("el catálogo", () => {
  it("son doce, con nombres únicos", () => {
    expect(Object.keys(WHATSAPP_TEMPLATES).sort()).toEqual(TODAS.map((m) => m.key).sort());
    const nombres = Object.values(WHATSAPP_TEMPLATES).map((s) => s.name);
    expect(new Set(nombres).size).toBe(12);
  });

  it("los recuentos de parámetros son los acordados", () => {
    expect(TODAS.map((m) => `${m.key}:${WHATSAPP_TEMPLATES[m.key].bodyVars.length}`)).toEqual([
      "welcome:6", "whatsapp_group:2", "reminder_24h:6", "reminder_2h:5",
      "reminder_15m:5", "session_live:5", "late_access:4", "thank_you:5",
      "course_complete:3", "course_follow_up:3", "survey:3", "certification_offer:3",
    ]);
  });

  it("el journey son once, y la oferta institucional queda fuera", () => {
    expect(JOURNEY).toHaveLength(11);
    expect(WHATSAPP_AUTOMATION_PLAN.map((e) => e.templateKey)).toEqual(JOURNEY.map((m) => m.key));
    expect(WHATSAPP_AUTOMATION_PLAN.map((e) => e.templateKey)).not.toContain(OFERTA.key);
  });
});

describe("nombres anteriores de Meta", () => {
  // Las reglas guardadas en produccion todavia apuntan a estos nombres. Si no se
  // resolvieran hacia la ficha nueva, el motor caeria en la copia de la regla y
  // enviaria a Meta una plantilla que ya no existe: un 132001 por mensaje.
  const RENOMBRADAS = [
    { antiguo: "ra_training_agradecimiento_final", nuevo: "ra_training_fin_sesion", vars: 5 },
    { antiguo: "ra_training_encuesta", nuevo: "ra_training_encuesta_experiencia", vars: 3 },
  ];

  it.each(RENOMBRADAS)("$antiguo resuelve a $nuevo", ({ antiguo, nuevo, vars }) => {
    const ficha = canonicalTemplate(antiguo);
    expect(ficha?.name).toBe(nuevo);
    expect(ficha?.bodyVars).toHaveLength(vars);
  });

  it.each(RENOMBRADAS)("una regla con $antiguo envía el contrato nuevo", ({ antiguo, nuevo, vars }) => {
    const binding = templateBindingOf({
      waTemplateName: antiguo,
      waTemplateLanguage: "es",
      // La copia obsoleta guardada el dia que se creo la regla.
      waTemplateBodyVars: ["nombre", "curso"],
      waTemplateUrlVar: null,
    });
    expect(binding?.name).toBe(nuevo);
    expect(binding?.bodyVars).toHaveLength(vars);
  });

  it("ningún nombre anterior sigue en el catálogo", () => {
    const nombres = Object.values(WHATSAPP_TEMPLATES).map((s) => s.name);
    for (const { antiguo } of RENOMBRADAS) expect(nombres).not.toContain(antiguo);
  });
});

describe("panel y vista previa", () => {
  const panel = readFileSync(join(process.cwd(), "src/app/admin/mensajes/WhatsAppTestPanel.tsx"), "utf8");
  const ruta = readFileSync(join(process.cwd(), "src/app/api/admin/whatsapp/test/route.ts"), "utf8");

  it("el panel ofrece las doce", () => {
    const claves = [...panel.matchAll(/\{ key: "([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(claves).toEqual(TODAS.map((m) => m.key));
  });

  it("cambiar de plantilla borra la vista previa anterior", () => {
    // Sin esto, la previa de la plantilla anterior seguia en pantalla bajo el
    // nombre de la nueva, y quien comprueba doce seguidas da por buena una que
    // no ha mirado.
    const handler = panel.slice(panel.indexOf("function elegirPlantilla"), panel.indexOf("async function ejecutar"));
    expect(handler).toContain("setPreview(null)");
    expect(handler).toContain("setAviso(null)");
    expect(panel).toContain("onChange={(event) => elegirPlantilla(event.target.value)}");
  });

  it("hay un valor de ejemplo para cada variable de las doce", () => {
    const ejemplo = ruta.slice(ruta.indexOf("const EJEMPLO"), ruta.indexOf("const schema"));
    for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
      for (const variable of spec.bodyVars) {
        expect(ejemplo, `falta ${variable}`).toContain(`${variable}:`);
      }
    }
  });

  it("el límite permite una ronda completa de las doce", () => {
    expect(ruta).toContain("const LIMITE_PRUEBAS = 15");
    expect(ruta).toContain("{ limit: LIMITE_PRUEBAS, windowMs: 10 * 60_000 }");
  });
});
