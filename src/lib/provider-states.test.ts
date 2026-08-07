import { describe, expect, it } from "vitest";
import type { MessageStatus } from "@prisma/client";
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

  it("llega hasta LEÍDO, que es el último peldaño de WhatsApp", () => {
    expect(nextMessageStatus("ENTREGADO", "READ")).toBe("LEIDO");
    // La lectura implica entrega: si el webhook de entrega se perdió, se sube
    // igual en lugar de quedarse esperando un evento que ya no llegará.
    expect(nextMessageStatus("ACEPTADO", "READ")).toBe("LEIDO");
    expect(nextMessageStatus("LEIDO", "DELIVERED")).toBeNull();
    expect(nextMessageStatus("LEIDO", "READ")).toBeNull();
  });

  it("tolera eventos fuera de orden sin retroceder", () => {
    // Meta no garantiza el orden ni la unicidad de sus webhooks.
    expect(nextMessageStatus("LEIDO", "SENT")).toBeNull();
    expect(nextMessageStatus("ENTREGADO", "ACCEPTED")).toBeNull();
    expect(nextMessageStatus("ENVIADO", "SENT")).toBeNull();
  });

  it("un fallo tardío no borra una entrega ya constatada", () => {
    expect(nextMessageStatus("ENTREGADO", "FAILED")).toBeNull();
    expect(nextMessageStatus("LEIDO", "FAILED")).toBeNull();
    // Antes de la entrega sí es información nueva y válida.
    expect(nextMessageStatus("ACEPTADO", "FAILED")).toBe("FALLIDO");
    expect(nextMessageStatus("ENVIADO", "FAILED")).toBe("FALLIDO");
  });

  it("un fallo solo se corrige con constancia de entrega o lectura", () => {
    expect(nextMessageStatus("FALLIDO", "DELIVERED")).toBe("ENTREGADO");
    expect(nextMessageStatus("FALLIDO", "READ")).toBe("LEIDO");
    expect(nextMessageStatus("FALLIDO", "SENT")).toBeNull();
    expect(nextMessageStatus("FALLIDO", "ACCEPTED")).toBeNull();
  });

  it("recorre la escalera completa de WhatsApp en orden", () => {
    let estado: MessageStatus = "PROGRAMADO";
    for (const [evento, esperado] of [["ACCEPTED", "ACEPTADO"], ["SENT", "ENVIADO"], ["DELIVERED", "ENTREGADO"], ["READ", "LEIDO"]] as const) {
      const siguiente = nextMessageStatus(estado, evento);
      expect(siguiente).toBe(esperado);
      if (siguiente) estado = siguiente;
    }
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
