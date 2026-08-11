import { describe, expect, it } from "vitest";
import { canHandoffToFinance, FINANCE_HANDOFF_ROLES } from "./authorization";

describe("autorización del handoff a Finance", () => {
  it("autoriza exactamente Técnico (ADMIN interno) y Dirección", () => {
    expect(FINANCE_HANDOFF_ROLES).toEqual(["ADMIN", "DIRECCION"]);
    expect(canHandoffToFinance("ADMIN")).toBe(true);
    expect(canHandoffToFinance("DIRECCION")).toBe(true);
  });

  it("no autoriza perfiles históricos comerciales o de consulta", () => {
    expect(canHandoffToFinance("VENTAS")).toBe(false);
    expect(canHandoffToFinance("MARKETING")).toBe(false);
    expect(canHandoffToFinance("LECTURA")).toBe(false);
  });
});
