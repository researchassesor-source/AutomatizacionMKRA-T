import { describe, expect, it, vi } from "vitest";
import { scheduleTargets } from "./engine";
import type { ResolvedCourseSession } from "@/lib/course-sessions";

vi.mock("@/lib/db", () => ({ prisma: {} }));

/**
 * Cuando sale el cierre de sesion (`ra_training_fin_sesion`).
 *
 * El texto registrado en Meta dice "La siguiente sesión está programada para
 * {{5}}". Sin una sesion siguiente ese hueco no tiene con que rellenarse, y
 * enviarlo vacio es peor que no enviarlo: el contacto lee una fecha que no
 * existe. Por eso se omite en la ultima sesion.
 */
function sesion(position: number, total: number, inicio: string, fin: string): ResolvedCourseSession {
  return {
    id: `s${position}`,
    key: `s${position}`,
    title: null,
    startAt: new Date(inicio),
    endAt: new Date(fin),
    streamUrl: "https://meet.google.com/abc-defg-hij",
    timezone: "America/Guayaquil",
    isVirtual: false,
    position,
    totalSessions: total,
  };
}

const TRES = [
  sesion(1, 3, "2026-08-20T00:30:00Z", "2026-08-20T02:30:00Z"),
  sesion(2, 3, "2026-08-22T00:30:00Z", "2026-08-22T02:30:00Z"),
  sesion(3, 3, "2026-08-24T00:30:00Z", "2026-08-24T02:30:00Z"),
];
const NOW = new Date("2026-08-18T00:00:00Z");
const CIERRE = { trigger: "AFTER_COURSE", offsetMinutes: 5, planKey: "thank_you" };

describe("curso de tres sesiones", () => {
  const salidas = scheduleTargets(CIERRE, TRES, "enr-1", NOW, NOW);

  it("sale tras la sesión 1 y tras la 2, pero no tras la 3", () => {
    expect(salidas).toHaveLength(2);
    expect(salidas.map((s) => s.session?.position)).toEqual([1, 2]);
  });

  it("cada uno se cuenta desde que la sesión TERMINA, no desde que empieza", () => {
    salidas.forEach((salida, i) => {
      const fin = TRES[i].endAt;
      if (!fin) throw new Error("La sesión de prueba debe declarar su final.");
      expect(salida.scheduledAt.toISOString()).toBe(new Date(fin.getTime() + 5 * 60_000).toISOString());
    });
  });

  it("cada salida apunta a su propia sesión, para que el texto hable de ella", () => {
    // `contentSession` es de donde salen numero_sesion y proxima_sesion: si
    // apuntara siempre a la misma, las tres dirian lo mismo.
    expect(salidas.map((s) => s.contentSession?.position)).toEqual([1, 2]);
  });

  it("cada salida tiene su propia clave, así que no se pisan entre ellas", () => {
    const claves = salidas.map((s) => s.stepKey);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe("curso de una sola sesión", () => {
  it("no sale nunca: no hay siguiente que anunciar", () => {
    const una = [sesion(1, 1, "2026-08-20T00:30:00Z", "2026-08-20T02:30:00Z")];
    expect(scheduleTargets(CIERRE, una, "enr-1", NOW, NOW)).toHaveLength(0);
  });
});

describe("los rezagados no cambian", () => {
  it("salen en TODAS las sesiones, contados desde el inicio", () => {
    // Contraste deliberado: quien llega tarde necesita el enlace tambien en la
    // ultima sesion, asi que ese aviso no se omite.
    const salidas = scheduleTargets({ trigger: "AFTER_COURSE", offsetMinutes: 20, planKey: "late_access" }, TRES, "enr-1", NOW, NOW);
    expect(salidas).toHaveLength(3);
    expect(salidas[2].scheduledAt.toISOString()).toBe(new Date(TRES[2].startAt.getTime() + 20 * 60_000).toISOString());
  });
});

describe("compatibilidad con lo ya guardado", () => {
  it("la clave del plan sigue siendo thank_you", () => {
    // Es el `planKey` con el que estan guardadas las reglas en produccion y el
    // que forma la clave de idempotencia de los mensajes ya enviados. Cambiarlo
    // por estetica habria creado un segundo mensaje por cada uno existente.
    expect(CIERRE.planKey).toBe("thank_you");
    expect(scheduleTargets(CIERRE, TRES, "enr-1", NOW, NOW).length).toBeGreaterThan(0);
  });

  it("las claves conservan el formato por sesión de siempre", () => {
    const salidas = scheduleTargets(CIERRE, TRES, "enr-1", NOW, NOW);
    expect(salidas[0].stepKey).toBe("enrollment:enr-1:session:s1");
  });
});
