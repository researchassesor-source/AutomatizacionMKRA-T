import { describe, expect, it } from "vitest";
import { buildTemplateComponents, WHATSAPP_TEMPLATES, type WhatsAppTemplateSpec } from "./templates";

/**
 * Contrato de parametros de cada plantilla.
 *
 * Meta no valida por nombre sino por posicion: si el catalogo dice cuatro
 * variables y el payload lleva tres, la peticion falla entera con 132000 y el
 * contacto no recibe nada. El sintoma aparece en el envio, que es el peor
 * momento para descubrirlo, asi que se fija aqui.
 *
 * Lo que NO puede comprobar esta prueba es que Meta tenga registrado ese mismo
 * numero: Meta es un contrato externo que se edita fuera del repositorio. Para
 * eso esta `scripts/auditar-plantillas-whatsapp.ts`, que lo consulta en vivo.
 */
const TODAS = Object.entries(WHATSAPP_TEMPLATES) as Array<[string, WhatsAppTemplateSpec]>;

/** Un valor plausible por variable: lo que importa es la forma, no el texto. */
function valoresDe(spec: WhatsAppTemplateSpec): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const clave of spec.bodyVars) vars[clave] = `valor-${clave}`;
  if (spec.urlVar) vars[spec.urlVar] = "https://ra-training.com/prueba";
  return vars;
}

describe.each(TODAS)("plantilla %s", (_clave, spec) => {
  const construido = buildTemplateComponents(
    { name: spec.name, language: spec.language, bodyVars: [...spec.bodyVars], urlVar: spec.urlVar ?? null },
    valoresDe(spec),
  );

  it("se arma sin errores con sus propias variables", () => {
    expect(construido.ok, construido.ok ? "" : construido.error).toBe(true);
  });

  it("envia exactamente los parametros que declara, en su orden", () => {
    if (!construido.ok) return;
    const body = construido.components.find((c) => c.type === "body");
    expect(body?.parameters).toHaveLength(spec.bodyVars.length);
    expect(body?.parameters.map((p) => p.text)).toEqual(spec.bodyVars.map((v) => `valor-${v}`));
  });

  it("el texto registrado usa {{1}}..{{n}} sin huecos ni repeticiones", () => {
    // Un salto (por ejemplo {{1}}, {{3}}) desplaza todo lo que va detras: el
    // contacto recibiria la hora donde esperaba la fecha.
    const usados = [...spec.sample.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    expect([...new Set(usados)].sort((a, b) => a - b)).toEqual(
      spec.bodyVars.map((_, i) => i + 1),
    );
  });

  it("solo declara boton si la plantilla lo usa", () => {
    if (!construido.ok) return;
    const boton = construido.components.find((c) => c.type === "button");
    expect(Boolean(boton)).toBe(Boolean(spec.urlVar));
  });

  it("el idioma es el que se registro en Meta", () => {
    expect(spec.language).toBe("es");
  });
});

describe("el catalogo completo", () => {
  it("cubre las 12 plantillas y ningun nombre esta repetido", () => {
    const nombres = TODAS.map(([, s]) => s.name);
    expect(nombres).toHaveLength(12);
    expect(new Set(nombres).size).toBe(12);
  });

  it("todos los nombres cumplen el formato que exige Meta", () => {
    for (const [, spec] of TODAS) expect(spec.name).toMatch(/^[a-z0-9_]+$/);
  });
});
