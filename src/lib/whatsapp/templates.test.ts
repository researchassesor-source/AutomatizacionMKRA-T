import { describe, expect, it } from "vitest";
import { buildTemplateComponents, templateBindingOf, WHATSAPP_TEMPLATES } from "./templates";
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

  it("todas las variables de plantilla existen en el motor", () => {
    // Una variable que el motor no resuelve llegaría vacía a Meta y el mensaje
    // se rechazaría; que el nombre exista aquí es la única garantía barata.
    for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
      for (const key of [...spec.bodyVars, ...(spec.urlVar ? [spec.urlVar] : [])]) {
        expect(TEMPLATE_VARIABLES).toContain(key);
      }
    }
  });

  it("solo los dos avisos previos usan el enlace, y ambos lo exigen", () => {
    for (const entry of WHATSAPP_AUTOMATION_PLAN) {
      const usaEnlace = templateFieldsFor(entry).waTemplateBodyVars.includes("streamUrl");
      expect(usaEnlace).toBe(entry.planKey === "reminder_2h" || entry.planKey === "reminder_15m");
      // Meta rechaza un parámetro vacío: si la plantilla lleva el enlace, la
      // regla tiene que exigirlo o el mensaje fallaría en el envío.
      if (usaEnlace) expect(entry.requiresStreamUrl).toBe(true);
    }
  });

  it("el agradecimiento incluye a quien ya figura como COMPLETADO", () => {
    const gracias = WHATSAPP_AUTOMATION_PLAN.find((entry) => entry.planKey === "thank_you");
    expect(gracias?.enrollmentStatuses).toContain("COMPLETADO");
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
