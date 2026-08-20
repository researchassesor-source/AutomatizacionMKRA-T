import { describe, expect, it } from "vitest";
import {
  admiteTextoLibre,
  debeAbrirHandoff,
  describirVentana,
  VENTANA_ATENCION_MS,
  whatsappCustomerServiceWindow,
} from "./conversation";

/**
 * Ventana de atencion y handoff.
 *
 * La ventana real de Meta para texto libre humano. Lo que sale o no sale
 * durante una atención humana ya no se decide aquí: ver el comentario de
 * cabecera de `conversation.ts` — HUMAN_HANDOFF no calla automatizaciones.
 */
const AHORA = new Date("2026-08-20T15:00:00.000Z");
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);

describe("ventana de 24 horas", () => {
  it("sin mensajes del contacto está cerrada", () => {
    const v = whatsappCustomerServiceWindow(null, AHORA);
    expect(v.abierta).toBe(false);
    if (!v.abierta) expect(v.motivo).toBe("SIN_MENSAJES");
    expect(admiteTextoLibre(v)).toBe(false);
  });

  it("un mensaje reciente la abre y dice cuánto queda", () => {
    const v = whatsappCustomerServiceWindow(haceHoras(2), AHORA);
    expect(v.abierta).toBe(true);
    if (!v.abierta) return;
    expect(v.restanteMs).toBe(22 * 3_600_000);
    expect(admiteTextoLibre(v)).toBe(true);
  });

  it("a las 24 horas exactas ya está cerrada", () => {
    // El borde importa: un minuto de mas y Meta rechaza el envio.
    const v = whatsappCustomerServiceWindow(new Date(AHORA.getTime() - VENTANA_ATENCION_MS), AHORA);
    expect(v.abierta).toBe(false);
    if (!v.abierta) expect(v.motivo).toBe("EXPIRADA");
  });

  it("un segundo antes sigue abierta", () => {
    const v = whatsappCustomerServiceWindow(new Date(AHORA.getTime() - VENTANA_ATENCION_MS + 1000), AHORA);
    expect(v.abierta).toBe(true);
  });

  it("se cuenta desde el ÚLTIMO entrante, no desde el primero", () => {
    // Quien escribe dos veces reabre el plazo con el segundo mensaje.
    expect(whatsappCustomerServiceWindow(haceHoras(30), AHORA).abierta).toBe(false);
    expect(whatsappCustomerServiceWindow(haceHoras(1), AHORA).abierta).toBe(true);
  });

  it("el texto de la interfaz distingue los tres casos", () => {
    expect(describirVentana(whatsappCustomerServiceWindow(null, AHORA))).toContain("usa plantilla");
    expect(describirVentana(whatsappCustomerServiceWindow(haceHoras(30), AHORA))).toContain("Ventana cerrada");
    expect(describirVentana(whatsappCustomerServiceWindow(haceHoras(2), AHORA))).toContain("Ventana abierta");
    expect(describirVentana(whatsappCustomerServiceWindow(haceHoras(23.5), AHORA))).toMatch(/quedan \d+ min/);
  });
});

describe("apertura y cierre de la atención", () => {
  it("un entrante abre handoff desde automatización", () => {
    expect(debeAbrirHandoff("AUTOMATION")).toBe(true);
  });

  it("si la conversación estaba resuelta, volver a escribir la reabre", () => {
    // Que el contacto escriba de nuevo significa justamente que no lo estaba.
    expect(debeAbrirHandoff("RESOLVED")).toBe(true);
  });

  it("con handoff ya abierto no se reabre: sería ruido en la auditoría", () => {
    expect(debeAbrirHandoff("HUMAN_HANDOFF")).toBe(false);
  });

  it("una conversación nueva abre handoff", () => {
    expect(debeAbrirHandoff(null)).toBe(true);
  });
});
