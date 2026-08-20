import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sección K/L del release de estabilización: el flujo anterior encadenaba
 * "sincronizar catálogo" -> refrescar la lista EN EL NAVEGADOR -> un GET por
 * curso sobre esa lista ya vieja. Un curso nuevo, descubierto por el mismo
 * sync, quedaba fuera de la lectura de fechas hasta un segundo clic. Ahora
 * todo el trabajo ocurre en un solo viaje de servidor (/catalog/analyze), y
 * "Aplicar todos los cambios seguros" es una única confirmación global
 * (/catalog/apply-all), nunca curso por curso.
 */
const source = readFileSync(join(process.cwd(), "src/app/admin/cursos/SyncEverythingButton.tsx"), "utf8");
const analyzeRouteSource = readFileSync(join(process.cwd(), "src/app/api/admin/courses/catalog/analyze/route.ts"), "utf8");
const applyAllRouteSource = readFileSync(join(process.cwd(), "src/app/api/admin/courses/catalog/apply-all/route.ts"), "utf8");

describe("un solo viaje de servidor (no más N+1 desde el navegador)", () => {
  it("no queda ningún bucle de fetch por curso en el cliente", () => {
    // El patrón que causaba el incidente: iterar cursos y hacer un fetch por
    // cada uno desde el navegador. Con el orquestador ya no hace falta.
    expect(source).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*fetch\(/s);
    expect(source).not.toContain("courses.entries()");
  });

  it("analiza con una sola llamada a /catalog/analyze", () => {
    expect(source).toContain('fetch("/api/admin/courses/catalog/analyze"');
    const llamada = source.slice(source.indexOf('fetch("/api/admin/courses/catalog/analyze"'), source.indexOf(".catch(() => null);"));
    expect(llamada).toContain('body: JSON.stringify({ confirm: "SYNC_WORDPRESS_READ_ONLY" })');
  });

  it("el literal que manda coincide con lo que la ruta de análisis exige", () => {
    expect(analyzeRouteSource).toContain('z.literal("SYNC_WORDPRESS_READ_ONLY")');
  });
});

describe("el modal global muestra los cuatro totales exigidos", () => {
  it("sin cambios, con nuevas fechas, nuevos y sin fecha", () => {
    expect(source).toContain("sin cambios");
    expect(source).toContain("con nuevas fechas");
    expect(source).toContain("nuevo{totals.newCourse === 1");
    expect(source).toContain("sin fecha");
  });

  it("nada se crea ni se modifica hasta confirmar", () => {
    expect(source).toContain("Nada se crea ni se modifica hasta que confirmes");
  });
});

describe("aplicar todos los cambios seguros: una sola confirmación global", () => {
  it("manda el literal APPLY_ALL_SAFE_CHANGES a /catalog/apply-all, con la lista completa de items", () => {
    const inicio = source.indexOf('fetch("/api/admin/courses/catalog/apply-all"');
    expect(inicio).toBeGreaterThan(-1);
    const fin = source.indexOf(").catch(() => null);", inicio);
    const llamada = source.slice(inicio, fin);
    expect(llamada).toContain('confirm: "APPLY_ALL_SAFE_CHANGES"');
    expect(llamada).toContain("aplicables.map(");
  });

  it("el literal coincide con lo que la ruta de aplicación global exige", () => {
    expect(applyAllRouteSource).toContain('z.literal("APPLY_ALL_SAFE_CHANGES")');
  });

  it("no hay un botón de confirmación por curso individual: solo el checkbox de exclusión y el botón global", () => {
    expect(source).not.toContain("Actualizar calendario");
    expect(source).not.toMatch(/onClick=\{.*courseId.*aplicar/);
    expect(source).toContain("Aplicar todos los cambios seguros");
  });

  it("un curso excluido con el checkbox no entra en la lista que se manda a aplicar", () => {
    expect(source).toContain("excluidos.has(item.courseId)");
    expect(source).toContain(".filter((item) => !excluidos.has(item.courseId))");
  });
});

describe("un curso desactualizado (REVISION_MISMATCH) queda visible para reintentar, no se pierde en silencio", () => {
  it("distingue el motivo de desactualización de un fallo genérico", () => {
    expect(source).toContain("REVISION_MISMATCH");
    expect(source).toContain("cambió mientras revisabas");
  });

  it("los cursos con revisión desactualizada permanecen en pantalla tras aplicar", () => {
    expect(source).toContain("stale.includes(item.courseId)");
  });
});

describe("resiliencia: un fallo de red al analizar no dice nada falso", () => {
  it("un análisis fallido avisa y vuelve a idle, sin dejar el modal a medias", () => {
    const rama = source.slice(source.indexOf("if (!response || !response.ok)"), source.indexOf("const body = await response.json();"));
    expect(rama).toContain('setFase("idle")');
  });
});
