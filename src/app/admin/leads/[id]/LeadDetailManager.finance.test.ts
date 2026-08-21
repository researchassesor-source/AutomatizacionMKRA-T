import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./LeadDetailManager.tsx", import.meta.url), "utf8");

describe("acción Finance en la ficha del contacto", () => {
  it("usa el permiso compartido, muestra los estados y protege el doble clic", () => {
    expect(source).toContain("canHandoffToFinance(role)");
    expect(source).toContain("Vincular con Finance");
    expect(source).toContain("Reintentar");
    expect(source).toContain("Abrir Finance");
    expect(source).toContain("if (financeRequestRef.current) return");
    expect(source).toContain("financeRequestRef.current = enrollment.id");
  });

  it("envía solo el id del Enrollment y nunca renderiza credenciales", () => {
    expect(source).toMatch(/\/api\/admin\/enrollments\/\$\{enrollment\.id\}\/finance/);
    expect(source).not.toContain("FINANCE_PASS");
    expect(source).not.toContain("FINANCE_USER");
    expect(source).not.toContain("FINANCE_API_URL");
  });
});

/**
 * Sección G del cierre de producción: un curso sin financeServiceId no debe
 * mostrar un botón que parece listo y falla al hacer clic. Se enlaza directo
 * a configurarlo en su lugar, en vez de ofrecer "Vincular con Finance".
 */
describe("curso sin financeServiceId: CTA de configuración en vez de un botón que va a fallar", () => {
  it("antes de decidir qué mostrar, comprueba financeServiceId del curso", () => {
    expect(source).toContain("if (!item.course.financeServiceId) {");
  });

  it("el CTA enlaza directo a este curso en /admin/cursos, no a una búsqueda genérica", () => {
    expect(source).toMatch(/href=\{`\/admin\/cursos\?configurarFinance=\$\{item\.course\.id\}`\}/);
    expect(source).toContain("Configurar Finance");
  });

  it("el CTA es un enlace de navegación, no un botón que dispare linkWithFinance", () => {
    const inicio = source.indexOf("if (!item.course.financeServiceId) {");
    const cuerpo = source.slice(inicio, source.indexOf("const isBusy = busyFinanceId"));
    expect(cuerpo).not.toContain("linkWithFinance");
    expect(cuerpo).not.toContain("onClick");
  });
});
