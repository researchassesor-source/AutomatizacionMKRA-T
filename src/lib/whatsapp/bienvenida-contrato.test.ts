import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTemplateComponents, WHATSAPP_TEMPLATES } from "./templates";

/**
 * Contrato de la bienvenida, que es la que se rompio.
 *
 * La plantilla se edito en Meta entre el 13 y el 14 de agosto de 2026 y paso de
 * cuatro variables a seis. El catalogo seguia declarando cuatro, asi que Meta
 * rechazaba cada envio con 132000 y el inscrito no recibia nada. El sintoma solo
 * aparecia en el momento del envio; esta prueba lo adelanta.
 */
const bienvenida = WHATSAPP_TEMPLATES.welcome;

/** Orden exacto registrado en Meta. La posicion importa: Meta no mira nombres. */
const ORDEN = ["nombre", "curso", "numero_sesion", "total_sesiones", "fechaSesion", "horaSesion"];

describe("bienvenida", () => {
  it("declara seis variables, en el orden de Meta", () => {
    expect(bienvenida.bodyVars).toEqual(ORDEN);
    expect(bienvenida.bodyVars).toHaveLength(6);
  });

  it("el payload lleva seis parámetros, en esa misma posición", () => {
    const valores = Object.fromEntries(ORDEN.map((v) => [v, `valor-${v}`]));
    const construido = buildTemplateComponents(
      { name: bienvenida.name, language: bienvenida.language, bodyVars: [...bienvenida.bodyVars], urlVar: null },
      valores,
    );
    expect(construido.ok).toBe(true);
    if (!construido.ok) return;
    const body = construido.components.find((c) => c.type === "body");
    expect(body?.parameters).toHaveLength(6);
    expect(body?.parameters.map((p) => p.text)).toEqual(ORDEN.map((v) => `valor-${v}`));
  });

  it("el texto anuncia la sesión en {{3}} y {{4}}, y fecha y hora en {{5}} y {{6}}", () => {
    expect(bienvenida.sample).toContain("Sesión {{3}} de {{4}}");
    expect(bienvenida.sample).toContain("📅 Fecha: {{5}}");
    expect(bienvenida.sample).toContain("🕒 Hora: {{6}}");
  });

  it("usa {{1}}..{{6}} sin huecos ni repeticiones", () => {
    const usados = [...bienvenida.sample.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect([...new Set(usados)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("el número de sesión es un número suelto, no una frase", () => {
    // El texto ya escribe "Sesión {{3}} de {{4}}": si la variable devolviera
    // "Sesión 1", el contacto leeria "Sesión Sesión 1 de 3".
    const engine = readFileSync(join(process.cwd(), "src/lib/nurture/engine.ts"), "utf8");
    expect(engine).toContain("numero_sesion: session ? String(session.position) : \"\"");
    expect(engine).toContain("total_sesiones: session ? String(session.totalSessions) : \"\"");
  });
});

describe("panel de prueba", () => {
  const panel = readFileSync(join(process.cwd(), "src/app/admin/mensajes/WhatsAppTestPanel.tsx"), "utf8");

  it("ofrece las once plantillas del plan, no solo cinco", () => {
    // Sin esto, seis de las once solo podian comprobarse esperando a que un
    // curso real las disparara.
    const claves = [...panel.matchAll(/\{ key: "([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(claves).toEqual([
      "welcome", "whatsapp_group", "reminder_24h", "reminder_2h", "reminder_15m",
      "session_live", "late_access", "thank_you", "course_complete",
      "course_follow_up", "survey",
    ]);
  });

  it("cada clave del panel existe en el catálogo", () => {
    for (const clave of [...panel.matchAll(/\{ key: "([a-z0-9_]+)"/g)].map((m) => m[1])) {
      expect(Object.keys(WHATSAPP_TEMPLATES)).toContain(clave);
    }
  });

  it("no ofrece la oferta institucional: no es parte del plan", () => {
    expect(panel).not.toContain("certification_offer");
  });
});

describe("la vista previa puede armar las once", () => {
  const ruta = readFileSync(join(process.cwd(), "src/app/api/admin/whatsapp/test/route.ts"), "utf8");
  const ejemplo = ruta.slice(ruta.indexOf("const EJEMPLO"), ruta.indexOf("const schema"));

  it("hay un valor de ejemplo para cada variable de cada plantilla del plan", () => {
    // Una variable sin ejemplo deja la vista previa en TEMPLATE_VARIABLE_MISSING,
    // que es exactamente lo que impediria comprobar la plantilla.
    const claves = [...ruta.matchAll(/\{ key: "([a-z0-9_]+)"/g)].map((m) => m[1]);
    void claves;
    for (const [clave, spec] of Object.entries(WHATSAPP_TEMPLATES)) {
      if (clave === "certification_offer") continue;
      for (const variable of spec.bodyVars) {
        expect(ejemplo, `${clave} necesita ${variable}`).toContain(`${variable}:`);
      }
    }
  });
});
