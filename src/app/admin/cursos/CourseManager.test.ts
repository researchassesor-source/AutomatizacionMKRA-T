import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sección G del cierre de producción: "Configurar Finance" desde la ficha de
 * un contacto enlaza directo a este curso, no solo a la lista de cursos. Se
 * comprueba leyendo el fuente, como el resto del proyecto: no hay jsdom ni
 * testing-library instalados.
 */
const fuente = readFileSync(join(process.cwd(), "src/app/admin/cursos/CourseManager.tsx"), "utf8");

describe("enlace directo a Configurar Finance de un curso específico", () => {
  it("acepta un courseId por prop, además del flujo de creación existente", () => {
    expect(fuente).toContain("openFinanceForCourseId");
  });

  it("al recibirlo, abre el editor de ESE curso y el modal de Finance, sin que nadie tenga que buscarlo en la tabla", () => {
    const inicio = fuente.indexOf("useEffect(() => {\n    if (!openFinanceForCourseId");
    expect(inicio).toBeGreaterThan(-1);
    const cuerpo = fuente.slice(inicio, fuente.indexOf("function closeEditor()"));
    expect(cuerpo).toContain("courses.find((item) => item.id === openFinanceForCourseId)");
    expect(cuerpo).toContain("setEditing(course)");
    expect(cuerpo).toContain("setConfigurandoFinance(true)");
  });

  it("limpia el parámetro de la URL tras abrir, para no reabrirse solo en cada visita", () => {
    const inicio = fuente.indexOf("useEffect(() => {\n    if (!openFinanceForCourseId");
    const cuerpo = fuente.slice(inicio, fuente.indexOf("function closeEditor()"));
    expect(cuerpo).toContain("router.replace(closeHref, { scroll: false });");
  });

  it("sin permiso de edición, no se auto-abre nada", () => {
    const inicio = fuente.indexOf("useEffect(() => {\n    if (!openFinanceForCourseId");
    const cuerpo = fuente.slice(inicio, fuente.indexOf("function closeEditor()"));
    expect(cuerpo).toContain("!openFinanceForCourseId || !canEdit");
  });
});

/**
 * Sección H del cierre de producción: el curso real "IA para la
 * Planificación Educativa" tiene isFree=true en el CRM, lo que permitió un
 * mensaje de bienvenida inmediato aunque la página pública muestra un
 * precio/promoción. No se cambia ninguna lógica de Paid First ni se infiere
 * isFree de price o de WordPress: el único cambio permitido es un texto de
 * ayuda visible junto al control.
 */
describe("ayuda visible junto al control Gratuito (isFree)", () => {
  it("explica qué decide el interruptor, con el texto exacto pedido", () => {
    expect(fuente).toContain("Si está activo, las automatizaciones del curso pueden empezar al registrarse. Si el curso es de pago, el journey empieza cuando el pago queda verificado.");
  });

  it("el checkbox de isFree sigue guardando el mismo campo, sin lógica nueva alrededor", () => {
    expect(fuente).toMatch(/<input name="isFree" type="checkbox" defaultChecked=\{Boolean\(current\.isFree\)\} \/>/);
  });

  it("no infiere isFree de price ni de ningún dato de WordPress", () => {
    expect(fuente).not.toMatch(/isFree\s*=\s*.*price/i);
    expect(fuente).not.toMatch(/isFree\s*=\s*.*wordpress/i);
  });
});
