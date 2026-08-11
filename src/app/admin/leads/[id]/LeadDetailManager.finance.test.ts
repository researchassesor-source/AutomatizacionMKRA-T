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
