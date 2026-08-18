import { describe, expect, it } from "vitest";
import { buildTemplateComponents, canonicalTemplate, fillTemplateBody, templateBindingOf, templateBodyWithPlaceholders, WHATSAPP_TEMPLATES } from "./templates";
import { WHATSAPP_AUTOMATION_PLAN, templateFieldsFor } from "@/lib/nurture/default-automations-whatsapp";
import { DEFAULT_AUTOMATION_PLAN } from "@/lib/nurture/default-automations";
import { TEMPLATE_VARIABLES } from "@/lib/nurture/engine";

const VARS = {
  nombre: "Angel",
  curso: "IA para Apoyo en Tareas Académicas",
  fecha: "20 de agosto de 2026",
  hora: "7:30 p. m.",
  fechaSesion: "20 de agosto de 2026",
  horaSesion: "7:30 p. m.",
  streamUrl: "https://meet.google.com/abc-defg-hij",
  link_reunion: "https://meet.google.com/abc-defg-hij",
  link_grupo_whatsapp: "https://chat.whatsapp.com/qa",
  link_curso_completo: "https://ra-training.com/cursos/ia/",
  link_encuesta: "https://forms.example.com/encuesta",
  sesion_actual: "Sesion 1 de 3",
  numero_sesion: "1",
  total_sesiones: "3",
  proxima_sesion: "22 de agosto de 2026",
};

describe("construcción de components", () => {
  it("respeta el orden de las variables: el primero alimenta {{1}}", () => {
    const result = buildTemplateComponents({ name: "t", language: "es", bodyVars: ["nombre", "curso"] }, VARS);
    expect(result).toEqual({
      ok: true,
      components: [{ type: "body", parameters: [{ type: "text", text: "Angel" }, { type: "text", text: VARS.curso }] }],
    });
  });

  it("rechaza una variable ausente indicando su posición", () => {
    const result = buildTemplateComponents({ name: "t", language: "es", bodyVars: ["nombre", "inexistente"] }, VARS);
    expect(result).toMatchObject({ ok: false, errorCode: "TEMPLATE_VARIABLE_MISSING" });
    if (!result.ok) expect(result.error).toContain("{{2}}");
  });

  it("rechaza un valor vacío en lugar de dejar que Meta lo rechace", () => {
    const result = buildTemplateComponents({ name: "t", language: "es", bodyVars: ["streamUrl"] }, { ...VARS, streamUrl: "" });
    expect(result).toMatchObject({ ok: false, errorCode: "TEMPLATE_VARIABLE_INVALID" });
  });

  it("rechaza valores con saltos de línea o espacios seguidos", () => {
    expect(buildTemplateComponents({ name: "t", language: "es", bodyVars: ["curso"] }, { curso: "Curso\ncon salto" }))
      .toMatchObject({ ok: false, errorCode: "TEMPLATE_VARIABLE_INVALID" });
    expect(buildTemplateComponents({ name: "t", language: "es", bodyVars: ["curso"] }, { curso: "Curso     largo" }))
      .toMatchObject({ ok: false, errorCode: "TEMPLATE_VARIABLE_INVALID" });
  });

  it("añade el componente de botón de URL cuando la plantilla lo declara", () => {
    const result = buildTemplateComponents(
      { name: "t", language: "es", bodyVars: ["nombre"], urlVar: "streamUrl" },
      VARS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.components[1]).toEqual({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: VARS.streamUrl }],
      });
    }
  });

  it("rechaza el botón si su variable no tiene valor", () => {
    const result = buildTemplateComponents(
      { name: "t", language: "es", bodyVars: ["nombre"], urlVar: "streamUrl" },
      { ...VARS, streamUrl: "" },
    );
    expect(result).toMatchObject({ ok: false, errorCode: "TEMPLATE_BUTTON_INVALID" });
  });

  it("una plantilla sin variables produce components vacío, no un body hueco", () => {
    const result = buildTemplateComponents({ name: "t", language: "es", bodyVars: [] }, VARS);
    expect(result).toEqual({ ok: true, components: [] });
  });
});

describe("enlace regla-plantilla", () => {
  it("devuelve null si la regla no declara plantilla", () => {
    expect(templateBindingOf({ waTemplateName: null, waTemplateLanguage: null, waTemplateBodyVars: null, waTemplateUrlVar: null })).toBeNull();
    expect(templateBindingOf({ waTemplateName: "   ", waTemplateLanguage: "es", waTemplateBodyVars: [], waTemplateUrlVar: null })).toBeNull();
  });

  it("usa 'es' cuando el idioma no está declarado", () => {
    const binding = templateBindingOf({ waTemplateName: "t", waTemplateLanguage: null, waTemplateBodyVars: ["nombre"], waTemplateUrlVar: null });
    expect(binding).toMatchObject({ language: "es", bodyVars: ["nombre"] });
  });

  it("descarta entradas no textuales de waTemplateBodyVars", () => {
    const binding = templateBindingOf({ waTemplateName: "t", waTemplateLanguage: "es", waTemplateBodyVars: ["nombre", 7, null, ""], waTemplateUrlVar: null });
    expect(binding?.bodyVars).toEqual(["nombre"]);
  });
});

describe("plan estándar de WhatsApp", () => {
  it("cubre los mismos cinco momentos que el plan de correo", () => {
    expect(WHATSAPP_AUTOMATION_PLAN.map((entry) => entry.planKey))
      .toEqual(DEFAULT_AUTOMATION_PLAN.map((entry) => entry.planKey));
    for (const entry of WHATSAPP_AUTOMATION_PLAN) {
      const email = DEFAULT_AUTOMATION_PLAN.find((item) => item.planKey === entry.planKey);
      expect(entry.trigger).toBe(email?.trigger);
      expect(entry.offsetMinutes).toBe(email?.offsetMinutes);
    }
  });

  it("las cinco entradas declaran plantilla, y sus nombres cumplen el formato de Meta", () => {
    for (const entry of WHATSAPP_AUTOMATION_PLAN) {
      const fields = templateFieldsFor(entry);
      expect(fields.waTemplateName).toMatch(/^[a-z0-9_]+$/);
      expect(fields.waTemplateName.length).toBeLessThanOrEqual(512);
      expect(fields.waTemplateLanguage).toBe("es");
      expect(fields.waTemplateBodyVars.length).toBeGreaterThan(0);
    }
  });

  it("los nombres de plantilla son únicos", () => {
    const nombres = Object.values(WHATSAPP_TEMPLATES).map((spec) => spec.name);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("conserva exactamente los mappings aprobados", () => {
    expect(Object.fromEntries(
      Object.entries(WHATSAPP_TEMPLATES).map(([key, spec]) => [key, spec.bodyVars]),
    )).toEqual({
      welcome: ["nombre", "curso", "numero_sesion", "total_sesiones", "fechaSesion", "horaSesion"],
      whatsapp_group: ["curso", "link_grupo_whatsapp"],
      reminder_24h: ["nombre", "curso", "numero_sesion", "total_sesiones", "fechaSesion", "horaSesion"],
      reminder_2h: ["nombre", "curso", "numero_sesion", "total_sesiones", "horaSesion"],
      reminder_15m: ["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"],
      session_live: ["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"],
      late_access: ["nombre", "curso", "numero_sesion", "streamUrl"],
      course_complete: ["nombre", "curso", "link_curso_completo"],
      course_follow_up: ["nombre", "curso", "link_curso_completo"],
      survey: ["nombre", "curso", "link_encuesta"],
      thank_you: ["nombre", "curso", "numero_sesion", "total_sesiones", "proxima_sesion"],
      // Campaña comercial: no pertenece al plan de once mensajes.
      certification_offer: ["nombre", "curso", "link_oferta_institucional"],
    });
  });

  it("todas las variables de plantilla existen en el motor", () => {
    // Una variable que el motor no resuelve llegaría vacía a Meta y el mensaje
    // se rechazaría; que el nombre exista aquí es la única garantía barata.
    for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
      for (const key of [...spec.bodyVars, ...(spec.urlVar ? [spec.urlVar] : [])]) {
        expect(TEMPLATE_VARIABLES).toContain(key);
      }
    }
  });

  it("solo los avisos de acceso usan el enlace, y todos lo exigen", () => {
    for (const entry of WHATSAPP_AUTOMATION_PLAN) {
      const vars = templateFieldsFor(entry).waTemplateBodyVars;
      const usaEnlace = vars.includes("streamUrl") || vars.includes("link_reunion");
      expect(usaEnlace).toBe(["reminder_15m", "session_live", "late_access"].includes(entry.planKey));
      // Meta rechaza un parámetro vacío: si la plantilla lleva el enlace, la
      // regla tiene que exigirlo o el mensaje fallaría en el envío.
      if (usaEnlace) expect(entry.requiresStreamUrl).toBe(true);
    }
  });

  it("el agradecimiento no se reprograma para quien ya figura como COMPLETADO", () => {
    const gracias = WHATSAPP_AUTOMATION_PLAN.find((entry) => entry.planKey === "thank_you");
    expect(gracias?.enrollmentStatuses).not.toContain("COMPLETADO");
  });

  it("todo registro del formulario recibe las automatizaciones de WhatsApp", () => {
    const bienvenida = WHATSAPP_AUTOMATION_PLAN.find((entry) => entry.planKey === "welcome");
    expect(bienvenida?.enrollmentStatuses).toEqual(["INTERESADO", "INSCRITO", "EN_CURSO"]);
    expect(WHATSAPP_AUTOMATION_PLAN.every((entry) => entry.enrollmentStatuses.includes("INTERESADO"))).toBe(true);
  });
  // El contrato literal de las doce vive ahora en contrato-plantillas.test.ts,
  // que compara cada `sample` con una copia independiente tomada del panel de
  // Meta. Tenerlo en dos sitios significaba actualizar dos veces y descubrir
  // la diferencia solo cuando una de las dos se olvidaba.

  it("el texto usa cada posición declarada, sin huecos ni sobrantes", () => {
    // Un {{5}} en el texto de una plantilla de cuatro variables llegaria a los
    // contactos como "{{5}}" literal, porque no hay nada con que rellenarlo.
    for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
      const posiciones = [...spec.sample.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
      const esperadas = spec.bodyVars.map((_, index) => index + 1);
      expect([...new Set(posiciones)].sort((a, b) => a - b), `Posiciones usadas en ${spec.name}`).toEqual(esperadas);
    }
  });

  it("la vista previa reproduce el mensaje con los valores puestos", () => {
    const quince = WHATSAPP_TEMPLATES.reminder_15m;
    const render = fillTemplateBody(quince, (variable) => VARS[variable as keyof typeof VARS]);

    // Ni un marcador sobrevive: un {{n}} suelto llegaria al contacto tal cual.
    expect(render).not.toMatch(/\{\{\d+\}\}/);
    // Cada valor cae en la frase que le corresponde, no solo aparece.
    expect(render).toContain(`Sesión ${VARS.numero_sesion} de ${VARS.total_sesiones}`);
    expect(render).toContain(`🎓 ${VARS.curso}`);
    expect(render).toContain(`👉 ${VARS.streamUrl}`);
    expect(render).toContain("Hola Angel 👋");
    // El texto fijo que rodea a las variables se conserva intacto.
    expect(render.startsWith("🚀 ¡Comenzamos en 15 minutos!")).toBe(true);
    expect(render.endsWith("R.A. Training")).toBe(true);
  });

  it("el cuerpo guardado en la regla es el mismo texto, con los marcadores del motor", () => {
    // Si esto se rompe, el CRM esta guardando como historial un mensaje que no
    // es el que se envio.
    for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
      const conMarcadores = templateBodyWithPlaceholders(spec);
      expect(conMarcadores).not.toMatch(/\{\{\d+\}\}/);
      for (const variable of spec.bodyVars) expect(conMarcadores).toContain(`{{${variable}}}`);
      // Quitando los marcadores, el texto restante debe ser identico.
      const sinVariables = (texto: string) => texto.replace(/\{\{[^}]+\}\}/g, "·");
      expect(sinVariables(conMarcadores)).toBe(sinVariables(spec.sample));
    }
  });

  it("el plan de WhatsApp deriva su cuerpo de la plantilla, no lo redacta aparte", () => {
    for (const entry of WHATSAPP_AUTOMATION_PLAN) {
      expect(entry.body).toBe(templateBodyWithPlaceholders(WHATSAPP_TEMPLATES[entry.templateKey]));
    }
  });

  it("una regla guardada con variables desfasadas se corrige con el catálogo", () => {
    // Situacion real: la regla se creo cuando el codigo declaraba tres
    // variables para el aviso de 15 minutos. Mandar esa copia significaria un
    // rechazo 132000 de Meta en el primer envio real.
    const binding = templateBindingOf({
      waTemplateName: "ra_training_acceso_15min",
      waTemplateLanguage: "es_ES",
      waTemplateBodyVars: ["nombre", "curso", "streamUrl"],
      waTemplateUrlVar: null,
    });
    expect(binding?.bodyVars).toEqual(["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"]);
    expect(binding?.language).toBe("es");
  });

  it("una plantilla ajena al plan conserva lo que declara su regla", () => {
    expect(canonicalTemplate("plantilla_dada_de_alta_a_mano")).toBeNull();
    const binding = templateBindingOf({
      waTemplateName: "plantilla_dada_de_alta_a_mano",
      waTemplateLanguage: "en_US",
      waTemplateBodyVars: ["nombre"],
      waTemplateUrlVar: null,
    });
    expect(binding).toMatchObject({ language: "en_US", bodyVars: ["nombre"] });
  });

  it("las cinco plantillas se construyen con las variables reales del motor", () => {
    for (const entry of WHATSAPP_AUTOMATION_PLAN) {
      const fields = templateFieldsFor(entry);
      const binding = templateBindingOf({ ...fields, waTemplateBodyVars: fields.waTemplateBodyVars });
      if (!binding) throw new Error(`La entrada ${entry.planKey} no produjo enlace de plantilla.`);
      expect(buildTemplateComponents(binding, VARS).ok).toBe(true);
    }
  });
});
