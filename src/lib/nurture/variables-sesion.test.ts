import { describe, expect, it, vi } from "vitest";
import { scheduleTargets } from "./engine";
import type { ResolvedCourseSession } from "@/lib/course-sessions";

vi.mock("@/lib/db", () => ({ prisma: {} }));

/**
 * Variables de sesion del contrato canonico.
 *
 * Los textos aprobados escriben "Sesión {{n}} de {{total}}" alrededor de las
 * variables, asi que estas tienen que devolver el numero desnudo. Una variable
 * que devuelva "Sesión 1" produce "Sesión Sesión 1 de 3 sesiones", y eso llega
 * al contacto tal cual.
 */
function sesion(position: number, totalSessions: number, startAt: string, endAt?: string): ResolvedCourseSession {
  return {
    id: `s${position}`,
    key: `s${position}`,
    title: null,
    startAt: new Date(startAt),
    endAt: endAt ? new Date(endAt) : null,
    streamUrl: "https://meet.google.com/abc-defg-hij",
    timezone: "America/Guayaquil",
    isVirtual: false,
    position,
    totalSessions,
  };
}

const TRES = [
  sesion(1, 3, "2026-08-20T00:30:00Z", "2026-08-20T02:30:00Z"),
  sesion(2, 3, "2026-08-22T00:30:00Z", "2026-08-22T02:30:00Z"),
  sesion(3, 3, "2026-08-24T00:30:00Z", "2026-08-24T02:30:00Z"),
];
const NOW = new Date("2026-08-18T00:00:00Z");

describe("el cierre de sesión solo se programa si hay una siguiente", () => {
  const cierre = { trigger: "AFTER_COURSE", offsetMinutes: 5, planKey: "session_complete" };

  it("en un curso de tres sesiones sale tras la primera y la segunda, no tras la tercera", () => {
    // El texto dice "continuaremos con {{proxima_sesion}}": despues de la
    // ultima no hay nada que anunciar, y enviarlo con el hueco vacio seria
    // peor que no enviarlo.
    const salidas = scheduleTargets(cierre, TRES, "enr-1", NOW, NOW);
    expect(salidas).toHaveLength(2);
    expect(salidas.map((s) => s.session?.position)).toEqual([1, 2]);
  });

  it("en un curso de una sola sesión no sale nunca", () => {
    const una = [sesion(1, 1, "2026-08-20T00:30:00Z", "2026-08-20T02:30:00Z")];
    expect(scheduleTargets(cierre, una, "enr-1", NOW, NOW)).toHaveLength(0);
  });

  it("se cuenta desde que la sesión TERMINA, no desde que empieza", () => {
    const salidas = scheduleTargets(cierre, TRES, "enr-1", NOW, NOW);
    const fin = TRES[0].endAt;
    if (!fin) throw new Error("La sesión de prueba debe declarar su final.");
    expect(salidas[0].scheduledAt.toISOString()).toBe(new Date(fin.getTime() + 5 * 60_000).toISOString());
  });

  it("los rezagados sí salen en todas las sesiones, contados desde el inicio", () => {
    // Contraste deliberado: quien llega tarde necesita el enlace tambien en la
    // ultima sesion.
    const salidas = scheduleTargets({ trigger: "AFTER_COURSE", offsetMinutes: 20, planKey: "late_access" }, TRES, "enr-1", NOW, NOW);
    expect(salidas).toHaveLength(3);
    expect(salidas[2].scheduledAt.toISOString()).toBe(new Date(TRES[2].startAt.getTime() + 20 * 60_000).toISOString());
  });
});
