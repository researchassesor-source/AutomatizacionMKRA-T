import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sección R del release de estabilización: "Configurar Finance" reemplaza el
 * campo de ID técnico como experiencia final para Dirección.
 */
const source = readFileSync(join(process.cwd(), "src/app/admin/cursos/FinanceServiceModal.tsx"), "utf8");

describe("Configurar Finance: consulta servidor-a-servidor, nunca expone credenciales", () => {
  it("consulta la lista segura, no un endpoint que exponga token/usuario/contraseña", () => {
    expect(source).toContain('fetch("/api/admin/finance/services"');
    expect(source).not.toMatch(/FINANCE_USER|FINANCE_PASS|\.token\b|accessToken/);
  });

  it("guarda con el endpoint dedicado del curso, con confirm explícito", () => {
    expect(source).toContain("/finance-service`");
    expect(source).toContain('method: "PATCH"');
    expect(source).toContain("confirm: true");
  });
});

describe("sugerencia por nombre: solo si el calce es único", () => {
  it("filtra por coincidencia exacta y exige exactamente un resultado", () => {
    expect(source).toContain("coincidencias.length === 1 ? coincidencias[0] : null");
  });

  it("nunca sugiere si ya hay un servicio vinculado", () => {
    const bloque = source.slice(source.indexOf("const sugerido = useMemo"), source.indexOf("const sugerido = useMemo") + 300);
    expect(bloque).toContain("if (currentServiceId || servicios.length === 0) return null;");
  });

  it("la sugerencia nunca se aplica sola: hace falta un clic explícito", () => {
    expect(source).toContain("Usar esta sugerencia");
    expect(source).toContain("onClick={() => setSeleccionado(sugerido.id)}");
    // No hay ningún useEffect que fije `seleccionado` a partir de `sugerido`.
    expect(source).not.toMatch(/useEffect\([^)]*setSeleccionado\(sugerido/s);
  });
});

describe("nunca autovincula con 0 o más de 1 coincidencias", () => {
  it("el guardado siempre depende de una selección explícita del usuario (seleccionado), nunca de la sugerencia directamente", () => {
    expect(source).toContain("onClick={() => guardar(seleccionado)}");
  });

  it('la opción "Sin vincular" existe y guarda null explícitamente, no una cadena vacía', () => {
    expect(source).toContain("checked={seleccionado === null}");
    expect(source).toContain('financeServiceId: id');
  });
});
