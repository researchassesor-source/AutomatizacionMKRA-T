import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sección T del release de estabilización: vista previa con conteos ANTES
 * de tocar nada, una sola confirmación global, y el envío ocurre en el
 * servidor (una llamada, no un bucle de fetch por inscripción).
 */
const source = readFileSync(join(process.cwd(), "src/app/admin/leads/BulkFinanceButton.tsx"), "utf8");

describe("vista previa antes de confirmar", () => {
  it("consulta la vista previa (solo lectura) antes de cualquier envío", () => {
    expect(source).toContain('fetch("/api/admin/commerce/finance-bulk/preview"');
  });

  it("muestra los cuatro conteos exigidos", () => {
    expect(source).toContain("por enviar");
    expect(source).toContain("ya vinculados");
    expect(source).toContain("cancelados");
    expect(source).toContain("requieren configuración");
  });

  it("no hay ningún bucle de fetch por inscripción en el cliente", () => {
    expect(source).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*fetch\(/s);
    expect(source).not.toContain(".map(async");
  });
});

describe("una sola confirmación global para ejecutar", () => {
  it("manda el literal SEND_COURSE_TO_FINANCE al endpoint de ejecución", () => {
    expect(source).toContain('fetch("/api/admin/commerce/finance-bulk/execute"');
    const llamada = source.slice(source.indexOf('fetch("/api/admin/commerce/finance-bulk/execute"'));
    expect(llamada).toContain('confirm: "SEND_COURSE_TO_FINANCE"');
  });

  it("no ofrece enviar si no hay nada pendiente", () => {
    expect(source).toContain("preview.porEnviar > 0");
  });
});

describe("resultado honesto tras ejecutar", () => {
  it("distingue una falla global de un simple conteo de fallidos", () => {
    expect(source).toContain("resultado.fallaGlobal");
    expect(source).toContain("no respondió a mitad del envío");
  });
});
