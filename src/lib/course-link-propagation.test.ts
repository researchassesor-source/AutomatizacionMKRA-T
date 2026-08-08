import { describe, expect, it } from "vitest";
import { buildCourseTimeline } from "./course-timeline";
import type { ResolvedCourseSession } from "./course-sessions";

/**
 * Punto 11 de la auditoría: al agregar el enlace, los recordatorios que lo
 * necesitan deben dejar de estar bloqueados por sí solos, sin recrear nada.
 */
const AHORA = new Date("2026-08-07T18:00:00.000Z");
const INICIO = new Date("2026-08-12T00:30:00.000Z");

function sesion(streamUrl: string | null): ResolvedCourseSession {
  return { id: "s1", key: "s1", title: null, startAt: INICIO, endAt: null, streamUrl } as ResolvedCourseSession;
}

function reglas() {
  return [
    { id: "r1", name: "Bienvenida", planKey: "welcome", channel: "EMAIL" as const, status: "ACTIVE" as const, trigger: "ON_REGISTRATION" as const, offsetMinutes: 0, requiresStreamUrl: false, waTemplateName: null },
    { id: "r2", name: "24h", planKey: "reminder_24h", channel: "EMAIL" as const, status: "ACTIVE" as const, trigger: "BEFORE_COURSE" as const, offsetMinutes: 1440, requiresStreamUrl: false, waTemplateName: null },
    { id: "r3", name: "2h", planKey: "reminder_2h", channel: "EMAIL" as const, status: "ACTIVE" as const, trigger: "BEFORE_COURSE" as const, offsetMinutes: 120, requiresStreamUrl: true, waTemplateName: null },
    { id: "r4", name: "15m", planKey: "reminder_15m", channel: "EMAIL" as const, status: "ACTIVE" as const, trigger: "BEFORE_COURSE" as const, offsetMinutes: 15, requiresStreamUrl: true, waTemplateName: null },
    { id: "r5", name: "Gracias", planKey: "thank_you", channel: "EMAIL" as const, status: "ACTIVE" as const, trigger: "AFTER_COURSE" as const, offsetMinutes: 60, requiresStreamUrl: false, waTemplateName: null },
  ];
}

describe("propagación del enlace de la sesión", () => {
  it("sin enlace, solo los dos avisos de acceso quedan bloqueados", () => {
    const pasos = buildCourseTimeline({ rules: reglas(), sessions: [sesion(null)], now: AHORA });
    const bloqueados = pasos.filter((paso) => paso.blockedReason).map((paso) => paso.planKey);
    expect(bloqueados).toEqual(["reminder_2h", "reminder_15m"]);
    // La bienvenida y el recordatorio de 24 h no dependen del enlace.
    expect(pasos.find((p) => p.planKey === "welcome")?.blockedReason).toBeNull();
    expect(pasos.find((p) => p.planKey === "reminder_24h")?.blockedReason).toBeNull();
  });

  it("al agregar el enlace, los avisos de acceso se desbloquean solos", () => {
    const pasos = buildCourseTimeline({ rules: reglas(), sessions: [sesion("https://meet.google.com/abc")], now: AHORA });
    expect(pasos.filter((paso) => paso.blockedReason)).toHaveLength(0);
  });

  it("el motivo dice qué falta, no un código", () => {
    const paso = buildCourseTimeline({ rules: reglas(), sessions: [sesion(null)], now: AHORA })
      .find((item) => item.planKey === "reminder_2h");
    expect(paso?.blockedReason).toContain("enlace");
    expect(paso?.blockedReason).not.toMatch(/MISSING_STREAM_URL|null|undefined/);
  });

  it("las fechas de los avisos se calculan desde la sesión, no se inventan", () => {
    const pasos = buildCourseTimeline({ rules: reglas(), sessions: [sesion("https://meet.google.com/abc")], now: AHORA });
    const dosHoras = pasos.find((item) => item.planKey === "reminder_2h");
    expect(dosHoras?.scheduledAt?.getTime()).toBe(INICIO.getTime() - 120 * 60_000);
    const quinceMin = pasos.find((item) => item.planKey === "reminder_15m");
    expect(quinceMin?.scheduledAt?.getTime()).toBe(INICIO.getTime() - 15 * 60_000);
  });
});
