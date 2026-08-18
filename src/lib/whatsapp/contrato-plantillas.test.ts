import { describe, expect, it } from "vitest";
import { buildTemplateComponents, WHATSAPP_TEMPLATES, type WhatsAppTemplateSpec } from "./templates";
import { WHATSAPP_AUTOMATION_PLAN } from "@/lib/nurture/default-automations-whatsapp";

/**
 * Contrato canonico del journey de WhatsApp.
 *
 * Meta no valida por nombre sino por posicion: si el catalogo dice seis
 * variables y el payload lleva cuatro, la peticion falla entera con 132000 y el
 * contacto no recibe nada. El sintoma aparece en el envio, que es el peor
 * momento para descubrirlo, asi que el numero y el orden se fijan aqui.
 *
 * Lo que NO puede comprobar esta prueba es que Meta tenga registrado ese mismo
 * contrato: Meta se edita fuera del repositorio. Para eso estan
 * `scripts/auditar-plantillas-whatsapp.ts` y el panel de integraciones.
 */

/** Los once del journey, en orden, con su contrato exacto. */
const JOURNEY = [
  { key: "welcome", name: "ra_training_bienvenida_inscripcion", categoria: "UTILITY", vars: ["nombre", "curso", "fechaSesion", "horaSesion", "numero_sesion", "total_sesiones"] },
  { key: "whatsapp_group", name: "ra_training_grupo_whatsapp", categoria: "MARKETING", vars: ["curso", "link_grupo_whatsapp"] },
  { key: "reminder_24h", name: "ra_training_recordatorio_24h", categoria: "UTILITY", vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "fechaSesion", "horaSesion"] },
  { key: "reminder_2h", name: "ra_training_acceso_2h", categoria: "UTILITY", vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "horaSesion"] },
  { key: "reminder_15m", name: "ra_training_acceso_15min", categoria: "UTILITY", vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"] },
  { key: "session_live", name: "ra_training_sesion_en_vivo", categoria: "UTILITY", vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "streamUrl"] },
  { key: "late_access", name: "ra_training_acceso_rezagados", categoria: "UTILITY", vars: ["nombre", "curso", "numero_sesion", "streamUrl"] },
  { key: "session_complete", name: "ra_training_fin_sesion", categoria: "UTILITY", vars: ["nombre", "curso", "numero_sesion", "total_sesiones", "proxima_sesion"] },
  { key: "course_complete", name: "ra_training_curso_completo", categoria: "MARKETING", vars: ["nombre", "curso", "link_curso_completo"] },
  { key: "course_follow_up", name: "ra_training_seguimiento_curso", categoria: "MARKETING", vars: ["nombre", "curso", "link_curso_completo"] },
  { key: "survey", name: "ra_training_encuesta_experiencia", categoria: "MARKETING", vars: ["nombre", "curso", "link_encuesta"] },
] as const;

/** Fuera del journey: campaña comercial con su propio calendario. */
const OFERTA = { key: "certification_offer", name: "ra_training_certificacion_institucional", categoria: "MARKETING", vars: ["nombre", "curso", "link_oferta_institucional"] } as const;

const TODAS = [...JOURNEY, OFERTA];

function valoresDe(spec: WhatsAppTemplateSpec): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const clave of spec.bodyVars) vars[clave] = `valor-${clave}`;
  if (spec.urlVar) vars[spec.urlVar] = "https://ra-training.com/prueba";
  return vars;
}

describe.each(TODAS)("$key", (esperado) => {
  const spec = WHATSAPP_TEMPLATES[esperado.key];

  it("se registra en Meta con el nombre y la categoría acordados", () => {
    expect(spec.name).toBe(esperado.name);
    expect(spec.category).toBe(esperado.categoria);
    expect(spec.name).toMatch(/^[a-z0-9_]+$/);
  });

  it("está en español", () => {
    expect(spec.language).toBe("es");
  });

  it("declara exactamente sus variables, en su orden", () => {
    expect(spec.bodyVars).toEqual(esperado.vars);
  });

  it("el texto usa {{1}}..{{n}} sin huecos ni repeticiones", () => {
    // Un salto (por ejemplo {{1}}, {{3}}) desplaza todo lo que va detras: el
    // contacto recibiria la hora donde esperaba la fecha.
    const usados = [...spec.sample.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect([...new Set(usados)].sort((a, b) => a - b)).toEqual(esperado.vars.map((_, i) => i + 1));
  });

  it("el payload lleva ese mismo número y orden de parámetros", () => {
    const construido = buildTemplateComponents(
      { name: spec.name, language: spec.language, bodyVars: [...spec.bodyVars], urlVar: spec.urlVar ?? null },
      valoresDe(spec),
    );
    expect(construido.ok, construido.ok ? "" : construido.error).toBe(true);
    if (!construido.ok) return;
    const body = construido.components.find((c) => c.type === "body");
    expect(body?.parameters).toHaveLength(esperado.vars.length);
    expect(body?.parameters.map((p) => p.text)).toEqual(esperado.vars.map((v) => `valor-${v}`));
  });

  it("solo declara botón si la plantilla lo usa", () => {
    // Ninguna de las doce usa boton de URL dinamica: los enlaces de sesion son
    // de dominios ajenos y un boton solo admite sufijo sobre un prefijo fijo.
    expect(spec.urlVar).toBeUndefined();
  });
});

describe("el journey", () => {
  it("son once mensajes, y el plan declara exactamente esos once", () => {
    expect(JOURNEY).toHaveLength(11);
    expect(WHATSAPP_AUTOMATION_PLAN.map((entry) => entry.templateKey)).toEqual(JOURNEY.map((m) => m.key));
  });

  it("la oferta institucional queda fuera del journey", () => {
    expect(WHATSAPP_AUTOMATION_PLAN.map((entry) => entry.templateKey)).not.toContain(OFERTA.key);
    expect(Object.keys(WHATSAPP_TEMPLATES)).toContain(OFERTA.key);
  });

  it("el catálogo son esas doce y ningún nombre se repite", () => {
    expect(Object.keys(WHATSAPP_TEMPLATES).sort()).toEqual(TODAS.map((m) => m.key).sort());
    const nombres = Object.values(WHATSAPP_TEMPLATES).map((s) => s.name);
    expect(new Set(nombres).size).toBe(12);
  });

  it("los recuentos de parámetros son los acordados", () => {
    // La tabla del contrato, escrita de una vez: es lo que hay que reproducir
    // en Meta y lo que fallaba al no coincidir.
    expect(JOURNEY.map((m) => `${m.key}:${m.vars.length}`)).toEqual([
      "welcome:6", "whatsapp_group:2", "reminder_24h:6", "reminder_2h:5",
      "reminder_15m:5", "session_live:5", "late_access:4", "session_complete:5",
      "course_complete:3", "course_follow_up:3", "survey:3",
    ]);
  });

  it("los nombres antiguos ya no aparecen en ningún sitio del catálogo", () => {
    const nombres = Object.values(WHATSAPP_TEMPLATES).map((s) => s.name);
    expect(nombres).not.toContain("ra_training_agradecimiento_final");
    expect(nombres).not.toContain("ra_training_encuesta");
  });

  it("la modalidad va escrita en el texto, no como variable", () => {
    // Hoy todo es online. Convertirlo en variable exigiria volver a someter la
    // plantilla a revision en Meta sin que nadie lo necesite todavia.
    expect(WHATSAPP_TEMPLATES.welcome.sample).toContain("💻 Modalidad: Online");
    expect(WHATSAPP_TEMPLATES.welcome.bodyVars).not.toContain("modalidad");
  });
});
