import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Hallazgo original de producción: el botón mandaba `{ confirm: true }` al
 * sync de WordPress (422 silencioso), y además solo consultaba fechas para
 * cursos SIN ninguna sesión — un cambio de fecha en WordPress sobre un curso
 * que YA tenía sesiones nunca se detectaba.
 */
const source = readFileSync(join(process.cwd(), "src/app/admin/cursos/SyncEverythingButton.tsx"), "utf8");
const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/admin/courses/catalog/sync/route.ts"),
  "utf8",
);

describe("payload de sincronización de catálogo", () => {
  it("manda exactamente el literal que exige el endpoint", () => {
    const llamadaSync = source.slice(source.indexOf('fetch("/api/admin/courses/catalog/sync"'), source.indexOf(".catch(() => null);"));
    expect(llamadaSync).toContain('body: JSON.stringify({ confirm: "SYNC_WORDPRESS_READ_ONLY" })');
    expect(llamadaSync).not.toContain("confirm: true");
  });

  it("el literal coincide con lo que la ruta de sync realmente exige", () => {
    expect(routeSource).toContain('z.literal("SYNC_WORDPRESS_READ_ONLY")');
  });

  it("un error de catálogo no crea nada automáticamente: solo avisa y sigue leyendo", () => {
    const trasSync = source.slice(source.indexOf("if (sync && !sync.ok)"), source.indexOf("const encontradas: Propuesta[]"));
    expect(trasSync).not.toMatch(/method:\s*"POST"/);
    expect(source).toContain("Nada se crea ni se modifica hasta que confirmes");
  });
});

describe("detección de cambios de calendario (hallazgo: sesiones existentes nunca se comparaban)", () => {
  it("consulta schedule-proposal para TODOS los cursos recibidos, no solo los que no tienen sesiones", () => {
    // La causa del incidente era exactamente este filtro; no debe volver.
    expect(source).not.toContain("course.sessionsCount === 0");
    expect(source).toContain("for (const [indice, course] of courses.entries())");
  });

  it("un calendario que ya coincide (CALENDARIO_IGUAL) no genera ninguna fila", () => {
    expect(source).toContain('if (status === "CALENDARIO_IGUAL") continue;');
  });

  it("clasifica con el status que devuelve el servidor, con reserva por compatibilidad", () => {
    expect(source).toContain('const status: CalendarStatus = result.status ?? (result.ok ? "SIN_CALENDARIO_CRM" : "ERROR");');
  });
});

describe("confirmación explícita de un cambio de calendario", () => {
  it("muestra el calendario actual y el propuesto antes de aplicar nada", () => {
    expect(source).toContain("Las fechas publicadas cambiaron");
    expect(source).toContain("Actual en CRM:");
    expect(source).toContain("Publicado en la web:");
    expect(source).toContain("listaFechas(item.existingSessions)");
    expect(source).toContain("listaFechas(item.sessions)");
  });

  it("explica que solo se recalculan los mensajes pendientes y que lo enviado se conserva", () => {
    expect(source).toContain("se recalcularán únicamente los mensajes pendientes");
    expect(source).toContain("Los mensajes ya enviados se conservarán como historial");
  });

  it("ofrece exactamente los dos botones esperados, por curso", () => {
    expect(source).toContain("Mantener fechas actuales");
    expect(source).toContain("Actualizar calendario");
  });

  it("«Mantener fechas actuales» no llama a ningún endpoint: solo descarta la propuesta local", () => {
    const fn = source.slice(source.indexOf("function mantenerFechas"), source.indexOf("function mantenerFechas") + 200);
    expect(fn).not.toContain("fetch(");
    expect(fn).not.toContain("aplicar(");
    expect(source).toContain("onClick={() => mantenerFechas(item.courseId)}");
  });

  it("«Actualizar calendario» manda confirmación literal explícita con las fechas propuestas", () => {
    expect(source).toContain("body: JSON.stringify({ confirm: true, sessions: sesiones })");
    expect(source).toContain("onClick={() => actualizarCalendario(item)}");
  });

  it("el botón de aplicar se deshabilita mientras esa fila está en curso, sin bloquear las demás", () => {
    expect(source).toContain("disabled={procesando.has(item.courseId)}");
  });
});
