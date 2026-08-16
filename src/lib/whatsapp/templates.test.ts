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
  total_sesiones: "3",
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
      welcome: ["nombre", "curso", "fecha", "hora"],
      whatsapp_group: ["nombre", "curso", "link_grupo_whatsapp"],
      reminder_24h: ["nombre", "curso", "fechaSesion", "horaSesion"],
      reminder_2h: ["nombre", "curso", "horaSesion", "streamUrl"],
      reminder_15m: ["nombre", "curso", "horaSesion", "streamUrl"],
      session_live: ["nombre", "curso", "sesion_actual", "link_reunion"],
      late_access: ["nombre", "curso", "sesion_actual", "link_reunion"],
      course_complete: ["nombre", "curso", "link_curso_completo"],
      course_follow_up: ["nombre", "curso"],
      survey: ["nombre", "curso", "link_encuesta"],
      thank_you: ["nombre", "curso"],
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
      expect(usaEnlace).toBe(["reminder_2h", "reminder_15m", "session_live", "late_access"].includes(entry.planKey));
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

  /** Contrato literal que debe someterse a revisión y quedar aprobado en Meta. */
  const TEXTOS_FINALES = {
    ra_training_bienvenida_inscripcion: {
      idioma: "es",
      variables: 4,
      texto: "👋 Hola {{1}}, ¡tu inscripción está registrada! ✅\n\nTe esperamos en {{2}}.\n📅 Fecha: {{3}}\n🕒 Hora: {{4}}\n\nPor este número recibirás los recordatorios y enlaces necesarios para participar en tu curso. 📚\n\nEste es un canal automático de información. Si respondes a este chat, te indicaremos cómo comunicarte con nuestro equipo de atención.\n\nR.A. Training 💙",
    },
    ra_training_grupo_whatsapp: {
      idioma: "es",
      variables: 3,
      texto: "Hola {{1}}, tu registro a {{2}} esta confirmado.\n\nGrupo oficial de WhatsApp:\n{{3}}\n\nR.A. Training",
    },
    ra_training_recordatorio_24h: {
      idioma: "es",
      variables: 4,
      texto: "⏰ Hola {{1}}, te recordamos que mañana tienes tu sesión de {{2}}.\n\n📅 Fecha: {{3}}\n🕒 Hora: {{4}}\n\nTe recomendamos tener listo tu dispositivo y una conexión estable para ingresar sin inconvenientes.\n\nPor este número seguiremos enviándote la información necesaria para tu sesión.\n\nR.A. Training 📚",
    },
    ra_training_acceso_2h: {
      idioma: "es",
      variables: 4,
      texto: "🎓 Hola {{1}}, tu sesión de {{2}} comienza en aproximadamente 2 horas.\n\n🕒 Hora: {{3}}\n🔗 Enlace de acceso: {{4}}\n\nGuarda este enlace y procura ingresar unos minutos antes del inicio de la sesión.\n\n¡Nos vemos pronto!\nR.A. Training 💙",
    },
    ra_training_acceso_15min: {
      idioma: "es",
      variables: 4,
      texto: "🚀 Hola {{1}}, ¡ya casi comenzamos!\n\nTu sesión de {{2}} inicia en 15 minutos.\n\n🕒 Hora: {{3}}\n🔗 Ingresa aquí: {{4}}\n\nTe recomendamos conectarte desde ahora para estar listo al comenzar.\n\nR.A. Training 📚",
    },
    ra_training_agradecimiento_final: {
      idioma: "es",
      variables: 2,
      texto: "✅ Hola {{1}}, hemos finalizado {{2}}.\n\nGracias por acompañarnos y ser parte de esta capacitación. Esperamos que lo aprendido sea de utilidad para ti. 📚\n\nSi necesitas ayuda o tienes alguna consulta, puedes responder a este chat y te indicaremos cómo comunicarte con nuestro equipo.\n\nGracias por confiar en R.A. Training. 💙",
    },
    ra_training_sesion_en_vivo: {
      idioma: "es",
      variables: 4,
      texto: "Hola {{1}}, {{3}} de {{2}} ya esta comenzando.\n\nIngresa aqui: {{4}}\n\nR.A. Training",
    },
    ra_training_acceso_rezagados: {
      idioma: "es",
      variables: 4,
      texto: "Hola {{1}}, si aun no ingresaste a {{3}} de {{2}}, puedes usar este enlace:\n\n{{4}}\n\nR.A. Training",
    },
    ra_training_curso_completo: {
      idioma: "es",
      variables: 3,
      texto: "Hola {{1}}, puedes revisar la informacion completa de {{2}} aqui:\n\n{{3}}\n\nR.A. Training",
    },
    ra_training_seguimiento_curso: {
      idioma: "es",
      variables: 2,
      texto: "Hola {{1}}, gracias nuevamente por participar en {{2}}.\n\nSi necesitas apoyo adicional, responde a este chat y te orientaremos.\n\nR.A. Training",
    },
    ra_training_encuesta: {
      idioma: "es",
      variables: 3,
      texto: "Hola {{1}}, tu opinion nos ayuda a mejorar.\n\nCompleta la encuesta final de {{2}} aqui:\n\n{{3}}\n\nGracias por confiar en R.A. Training.",
    },
    // Campaña comercial, aparte de los once mensajes. Ya activa en Meta.
    ra_training_certificacion_institucional: {
      idioma: "es",
      variables: 3,
      texto: "Hola {{1}}, ya puedes obtener tu certificado institucional de {{2}}.\n\nAccede al curso completo de 60 horas y a tu certificado R.A. Training aqui:\n\n{{3}}\n\nR.A. Training",
    },
  } as const;

  it("cada plantilla conserva el nombre, idioma y número exacto de variables", () => {
    const enCodigo = Object.values(WHATSAPP_TEMPLATES);
    expect(enCodigo.map((spec) => spec.name).sort()).toEqual(Object.keys(TEXTOS_FINALES).sort());
    for (const spec of enCodigo) {
      const alta = TEXTOS_FINALES[spec.name as keyof typeof TEXTOS_FINALES];
      expect(alta, `La plantilla ${spec.name} no figura entre los textos finales.`).toBeDefined();
      expect(spec.language, `Idioma de ${spec.name}`).toBe(alta.idioma);
      expect(spec.bodyVars.length, `Número de variables de ${spec.name}`).toBe(alta.variables);
    }
  });

  it("el texto del catálogo coincide literalmente con el texto final", () => {
    // Comparacion caracter a caracter, saltos de linea incluidos. Un texto
    // "parecido" es peor que uno distinto: nadie lo revisa dos veces y el
    // panel acaba enseñando un mensaje que ningun contacto recibio.
    for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
      const alta = TEXTOS_FINALES[spec.name as keyof typeof TEXTOS_FINALES];
      expect(spec.sample, `Cuerpo de ${spec.name}`).toBe(alta.texto);
    }
  });

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
    expect(fillTemplateBody(quince, (variable) => VARS[variable as keyof typeof VARS])).toBe(
      `🚀 Hola Angel, ¡ya casi comenzamos!\n\nTu sesión de ${VARS.curso} inicia en 15 minutos.\n\n🕒 Hora: ${VARS.horaSesion}\n🔗 Ingresa aquí: ${VARS.streamUrl}\n\nTe recomendamos conectarte desde ahora para estar listo al comenzar.\n\nR.A. Training 📚`,
    );
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
    expect(binding?.bodyVars).toEqual(["nombre", "curso", "horaSesion", "streamUrl"]);
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
