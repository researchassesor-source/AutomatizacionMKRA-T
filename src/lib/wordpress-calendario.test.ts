import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeWordPressCourse } from "./wordpress-catalog";

/**
 * Calendario y WordPress.
 *
 * Comprobado contra la API productiva el 18/08/2026: devuelve 16 cursos y su
 * `acf` llega vacio, sin un solo campo de fecha, hora o sesion. Las unicas
 * fechas de la respuesta son `date` y `modified`, que son de publicacion del
 * post y no del curso.
 *
 * Por eso el calendario NO se sincroniza: deducirlo de la fecha de publicacion
 * o del titulo pondria a gente delante de una pantalla el dia equivocado. Las
 * sesiones siguen siendo manuales hasta que la fuente exponga el dato.
 */
const catalogo = readFileSync(join(process.cwd(), "src/lib/wordpress-catalog.ts"), "utf8");

describe("el sincronizador no inventa fechas", () => {
  it("no lee ningún campo de calendario de WordPress", () => {
    // Si algun dia la fuente lo expone, esta prueba obliga a decidirlo
    // explicitamente en lugar de que aparezca por accidente.
    expect(catalogo).not.toMatch(/fecha_inicio|fecha_fin|start_date|end_date|course_date|horario|session_date/i);
  });

  it("no usa la fecha de publicación del post como fecha del curso", () => {
    const post = {
      id: 1,
      slug: "curso-demo",
      link: "https://ra-training.com/curso-demo/",
      status: "publish",
      // Fecha de publicacion: NO es cuando ocurre el curso.
      date: "2026-01-05T10:00:00",
      modified: "2026-08-10T12:00:00",
      title: { rendered: "Curso demo · 20 de agosto 19:00" },
      acf: [],
    };
    const parsed = normalizeWordPressCourse(post);
    expect(parsed.officialSlug).toBe("curso-demo");
    // Nada del parseo produce fechas de sesion.
    expect(JSON.stringify(parsed)).not.toContain("2026-01-05");
    expect(JSON.stringify(parsed)).not.toContain("startsAt");
  });

  it("no deduce el calendario del título ni del contenido", () => {
    expect(catalogo).not.toMatch(/parseFecha|extraerFecha|match\(\/\d\{1,2\}\s*de\s/i);
  });

  it("sigue sincronizando lo que la fuente sí expone", () => {
    // El bloqueo es solo el calendario: catalogo, slug y estado se mantienen.
    expect(catalogo).toContain("crm_slug");
    expect(catalogo).toContain("status");
  });
});
