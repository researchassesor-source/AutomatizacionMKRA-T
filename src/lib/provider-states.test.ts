import { describe, expect, it } from "vitest";
import { nextMessageStatus } from "./nurture/provider-events";
import { isAutomationEligibleContact, retryDelayMinutes } from "./nurture/engine";

describe("estados verificables de proveedores", () => {
  it("avanza de aceptado a enviado y entregado", () => {
    expect(nextMessageStatus("ACEPTADO", "SENT")).toBe("ENVIADO");
    expect(nextMessageStatus("ENVIADO", "DELIVERED")).toBe("ENTREGADO");
  });

  it("no degrada estados terminales ni confunde simulación con envío", () => {
    expect(nextMessageStatus("ENTREGADO", "SENT")).toBeNull();
    expect(nextMessageStatus("REBOTADO", "ACCEPTED")).toBeNull();
    expect(nextMessageStatus("SIMULADO", "DELIVERED")).toBeNull();
  });

  it("excluye TEST, DEMO, UNKNOWN y contactos sin consentimiento", () => {
    expect(isAutomationEligibleContact("REAL", true)).toBe(true);
    expect(isAutomationEligibleContact("REAL", false)).toBe(false);
    for (const classification of ["TEST", "DEMO", "UNKNOWN"]) expect(isAutomationEligibleContact(classification, true)).toBe(false);
  });

  it("aplica reintento exponencial acotado", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMinutes)).toEqual([5, 10, 20, 40, 80, 240]);
  });
});
