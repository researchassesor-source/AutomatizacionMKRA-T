import { describe, expect, it } from "vitest";
import { formatMoment, humanReason, humanStatus, humanStatusFor, isRealFailure, messageMoment, relativeMoment, statusDotClass } from "./message-presentation";

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

  it("agrupa los once estados en seis tonos legibles", () => {
    const tonos = new Set(["PROGRAMADO","ENVIANDO","ACEPTADO","ENVIADO","ENTREGADO","LEIDO","REBOTADO","SIMULADO","FALLIDO","CANCELADO","OMITIDO"]
      .map((estado) => humanStatus(estado as never).tone));
    expect(tonos.size).toBe(6);
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

describe("futuro bloqueado frente a fallo real", () => {
  const AHORA = new Date("2026-08-07T18:00:00.000Z");
  const FUTURO = new Date("2026-08-13T18:00:00.000Z");
  const PASADO = new Date("2026-08-01T18:00:00.000Z");

  it("un mensaje futuro sin enlace no ha fallado: nadie lo intentó", () => {
    // Es el caso de los 93 avisos de acceso bloqueados en producción: contarlos
    // como fallos alarma sin motivo y esconde los fallos de verdad.
    const humano = humanStatusFor("OMITIDO", FUTURO, AHORA);
    expect(humano.label).toBe("Requiere configuración");
    expect(humano.tone).toBe("blocked");
    expect(isRealFailure("OMITIDO", FUTURO, AHORA)).toBe(false);
  });

  it("si ya le tocaba salir y no pudo, entonces sí es un fallo", () => {
    expect(humanStatusFor("OMITIDO", PASADO, AHORA).tone).toBe("problem");
    expect(isRealFailure("OMITIDO", PASADO, AHORA)).toBe(true);
  });

  it("los rechazos del proveedor siempre son fallos reales", () => {
    expect(isRealFailure("FALLIDO", FUTURO, AHORA)).toBe(true);
    expect(isRealFailure("REBOTADO", FUTURO, AHORA)).toBe(true);
  });

  it("lo que salió bien nunca cuenta como fallo", () => {
    for (const estado of ["PROGRAMADO", "ENVIADO", "ENTREGADO", "LEIDO", "SIMULADO"] as const) {
      expect(isRealFailure(estado, FUTURO, AHORA)).toBe(false);
    }
  });

  it("el punto de color distingue bloqueado de fallido", () => {
    expect(statusDotClass("OMITIDO", FUTURO)).toContain("is-blocked");
    expect(statusDotClass("OMITIDO", PASADO)).toContain("is-problem");
  });
});

describe("motivos legibles", () => {
  it("explica dónde se arregla un enlace que falta", () => {
    const motivo = humanReason("MISSING_STREAM_URL", "La sesión no tiene un enlace de transmisión configurado.");
    expect(motivo).toContain("Sesiones");
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

describe("momento visible de una comunicación", () => {
  const createdAt = new Date("2026-08-11T05:47:00.000Z");
  const scheduledAt = new Date("2026-08-12T00:15:00.000Z");

  it("Programado muestra scheduledAt y nunca createdAt", () => {
    const moment = messageMoment({ status: "PROGRAMADO", createdAt, scheduledAt });
    expect(moment).toEqual({ at: scheduledAt, label: "Programado para" });
    expect(formatMoment(moment.at)).toContain("7:15 p. m.");
  });

  it("enviado, entregado y leído muestran el evento real disponible", () => {
    const sentAt = new Date("2026-08-12T00:16:00.000Z");
    const deliveredAt = new Date("2026-08-12T00:17:00.000Z");
    const readAt = new Date("2026-08-12T00:18:00.000Z");
    expect(messageMoment({ status: "ENVIADO", createdAt, scheduledAt, sentAt }).at).toBe(sentAt);
    expect(messageMoment({ status: "ENTREGADO", createdAt, scheduledAt, deliveredAt }).at).toBe(deliveredAt);
    expect(messageMoment({ status: "LEIDO", createdAt, scheduledAt, readAt }).at).toBe(readAt);
  });
});
