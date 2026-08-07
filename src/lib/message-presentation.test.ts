import { describe, expect, it } from "vitest";
import { humanReason, humanStatus, relativeMoment, statusDotClass } from "./message-presentation";

describe("vocabulario humano de estados", () => {
  it("traduce los once estados internos sin dejar ninguno fuera", () => {
    const todos = ["PROGRAMADO","ENVIANDO","ACEPTADO","ENVIADO","ENTREGADO","LEIDO","REBOTADO","SIMULADO","FALLIDO","CANCELADO","OMITIDO"] as const;
    for (const estado of todos) {
      const humano = humanStatus(estado);
      expect(humano.label).toBeTruthy();
      expect(humano.hint).toBeTruthy();
    }
  });

  it("no filtra vocabulario del sistema a la interfaz", () => {
    const todos = ["PROGRAMADO","ACEPTADO","ENTREGADO","LEIDO","OMITIDO","SIMULADO","FALLIDO"] as const;
    for (const estado of todos) {
      const texto = `${humanStatus(estado).label} ${humanStatus(estado).hint}`;
      // Ni el nombre del estado interno ni jerga tecnica deben aparecer.
      expect(texto).not.toMatch(/ACEPTADO|OMITIDO|SIMULADO|webhook|token|wamid|API/i);
    }
  });

  it("agrupa los estados en cinco tonos, no en once", () => {
    const tonos = new Set(["PROGRAMADO","ENVIANDO","ACEPTADO","ENVIADO","ENTREGADO","LEIDO","REBOTADO","SIMULADO","FALLIDO","CANCELADO","OMITIDO"]
      .map((estado) => humanStatus(estado as never).tone));
    expect(tonos.size).toBe(5);
  });

  it("aceptado y enviado se leen igual: la diferencia es interna", () => {
    expect(humanStatus("ACEPTADO").label).toBe(humanStatus("ENVIADO").label);
  });

  it("la clase del punto refleja el tono", () => {
    expect(statusDotClass("ENTREGADO")).toContain("is-done");
    expect(statusDotClass("OMITIDO")).toContain("is-problem");
    expect(statusDotClass("SIMULADO")).toContain("is-test");
  });
});

describe("motivos legibles", () => {
  it("explica dónde se arregla un enlace que falta", () => {
    const motivo = humanReason("MISSING_STREAM_URL", "La sesión no tiene un enlace de transmisión configurado.");
    expect(motivo).toContain("Calendario");
    expect(motivo).not.toContain("MISSING_STREAM_URL");
  });

  it("prefiere el mensaje del proveedor cuando el código no se reconoce", () => {
    expect(humanReason("WHATSAPP_132001", "La plantilla no existe con ese nombre e idioma.")).toBe("La plantilla no existe con ese nombre e idioma.");
  });

  it("nunca devuelve un código a secas", () => {
    expect(humanReason("CODIGO_RARO", null)).not.toContain("CODIGO_RARO");
  });

  it("sin error no inventa un motivo", () => {
    expect(humanReason(null, null)).toBeNull();
  });
});

describe("tiempos relativos", () => {
  const ahora = new Date("2026-08-10T12:00:00.000Z");
  it("usa minutos, horas y días según la distancia", () => {
    expect(relativeMoment(new Date("2026-08-10T11:30:00.000Z"), ahora)).toContain("30");
    expect(relativeMoment(new Date("2026-08-10T09:00:00.000Z"), ahora)).toContain("3");
    expect(relativeMoment(new Date("2026-08-13T12:00:00.000Z"), ahora)).toContain("3");
  });
  it("tolera valores ausentes o inválidos", () => {
    expect(relativeMoment(null, ahora)).toBe("—");
    expect(relativeMoment("no-es-fecha", ahora)).toBe("—");
  });
});
