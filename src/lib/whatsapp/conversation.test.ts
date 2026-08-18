import { describe, expect, it } from "vitest";
import {
  admiteTextoLibre,
  automatizacionPermitida,
  debeAbrirHandoff,
  describirVentana,
  esMomentoOperativo,
  reanudarDesde,
  VENTANA_ATENCION_MS,
  whatsappCustomerServiceWindow,
} from "./conversation";
import { WHATSAPP_AUTOMATION_PLAN } from "@/lib/nurture/default-automations-whatsapp";

/**
 * Ventana de atencion y handoff.
 *
 * Dos riesgos distintos y opuestos. Dejar salir texto libre fuera de plazo
 * termina en un rechazo de Meta; callar un mensaje operativo deja a alguien sin
 * el enlace de su sesion. Por eso lo comercial se silencia y lo operativo no.
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

describe("qué se calla durante una atención humana", () => {
  const OPERATIVOS = ["reminder_24h", "reminder_2h", "reminder_15m", "session_live", "late_access", "thank_you"];
  const COMERCIALES = ["welcome", "whatsapp_group", "course_complete", "course_follow_up", "survey"];

  it("los avisos de acceso al curso siguen saliendo", () => {
    // Perder el enlace de la sesión es un daño concreto; el asesor no compite
    // con un recordatorio, porque no vende nada.
    for (const planKey of OPERATIVOS) {
      expect(automatizacionPermitida("HUMAN_HANDOFF", planKey), planKey).toBe(true);
      expect(esMomentoOperativo(planKey), planKey).toBe(true);
    }
  });

  it("los comerciales y conversacionales se callan", () => {
    for (const planKey of COMERCIALES) {
      expect(automatizacionPermitida("HUMAN_HANDOFF", planKey), planKey).toBe(false);
    }
  });

  it("los once momentos del plan están clasificados: ninguno queda sin decidir", () => {
    // Si mañana se añade un momento y nadie lo clasifica, esta prueba lo caza
    // antes de que salga encima de un asesor.
    const clasificados = new Set([...OPERATIVOS, ...COMERCIALES]);
    for (const entry of WHATSAPP_AUTOMATION_PLAN) {
      expect(clasificados.has(entry.planKey), `${entry.planKey} sin clasificar`).toBe(true);
    }
  });

  it("sin handoff no se calla nada", () => {
    for (const estado of ["AUTOMATION", "RESOLVED"] as const) {
      for (const planKey of [...OPERATIVOS, ...COMERCIALES]) {
        expect(automatizacionPermitida(estado, planKey), `${estado}/${planKey}`).toBe(true);
      }
    }
  });

  it("una conversación sin estado conocido no bloquea nada", () => {
    // Quien nunca escribió no tiene fila de conversación: no puede quedarse sin
    // sus mensajes por no haber hablado.
    expect(automatizacionPermitida(null, "course_follow_up")).toBe(true);
    expect(automatizacionPermitida(undefined, "welcome")).toBe(true);
  });

  it("un planKey desconocido se trata como comercial durante el handoff", () => {
    // Falla hacia el lado que solo cuesta una molestia, no una clase perdida:
    // en duda, no se habla encima del asesor.
    expect(automatizacionPermitida("HUMAN_HANDOFF", "algo_nuevo")).toBe(false);
    expect(automatizacionPermitida("HUMAN_HANDOFF", null)).toBe(false);
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

  it("al cerrar, lo comercial se reanuda desde el cierre y nunca hacia atrás", () => {
    // Reanudar y recibir de golpe el seguimiento de anteayer convertiría el
    // cierre en una descarga de mensajes viejos.
    const cierre = new Date("2026-08-20T18:00:00.000Z");
    expect(reanudarDesde(cierre).toISOString()).toBe(cierre.toISOString());
    expect(reanudarDesde(cierre).getTime()).toBeGreaterThanOrEqual(cierre.getTime());
  });
});
