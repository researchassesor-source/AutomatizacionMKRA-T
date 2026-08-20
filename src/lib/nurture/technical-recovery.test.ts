// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    outboundMessage: { findMany: vi.fn() },
  },
  rescheduleCourseAutomations: vi.fn(async () => ({})),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("./engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));

import { recuperarCodigosTecnicosAtascados } from "./technical-recovery";

const AHORA = new Date("2026-08-19T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.outboundMessage.findMany.mockResolvedValue([]);
  mocks.rescheduleCourseAutomations.mockResolvedValue({});
});

/**
 * Sección J del release de estabilización: SCHEDULE_RECONCILING es la red
 * bajo el recálculo puntual que cada endpoint ya dispara al cuarentenar. Si
 * esa llamada puntual fallara sin que nadie más la reintentara, el mensaje se
 * quedaría OMITIDO para siempre sin este barrido.
 *
 * Cierre de producción: HUMAN_HANDOFF_ACTIVE se suma a la lista. Ya no es una
 * condición de negocio (ese gate se eliminó, ver `conversation.ts`) — un
 * mensaje con ese código es un residuo de mensajes cuarentenados antes del
 * cambio, y recalcularlo es tan seguro como cualquier otro código técnico.
 */
describe("recuperarCodigosTecnicosAtascados", () => {
  it("consulta OMITIDO con los códigos técnicos conocidos", async () => {
    await recuperarCodigosTecnicosAtascados(AHORA);
    expect(mocks.prisma.outboundMessage.findMany).toHaveBeenCalledWith({
      where: { status: "OMITIDO", errorCode: { in: ["SCHEDULE_RECONCILING", "HUMAN_HANDOFF_ACTIVE"] } },
      select: { enrollment: { select: { courseId: true } } },
      distinct: ["enrollmentId"],
      take: 200,
    });
  });

  it("sin mensajes atascados, no reprograma nada", async () => {
    const resultado = await recuperarCodigosTecnicosAtascados(AHORA);
    expect(resultado).toEqual({ cursos: 0 });
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("reprograma cada curso distinto una sola vez, aunque tenga varios mensajes atascados", async () => {
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([
      { enrollment: { courseId: "curso-a" } },
      { enrollment: { courseId: "curso-a" } },
      { enrollment: { courseId: "curso-b" } },
    ]);
    const resultado = await recuperarCodigosTecnicosAtascados(AHORA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(2);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("curso-a", AHORA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("curso-b", AHORA);
    expect(resultado).toEqual({ cursos: 2 });
  });

  it("un mensaje sin enrollment (sin curso resoluble) se ignora sin reventar", async () => {
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([{ enrollment: null }]);
    const resultado = await recuperarCodigosTecnicosAtascados(AHORA);
    expect(resultado).toEqual({ cursos: 0 });
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("tope de 5 cursos por vuelta", async () => {
    mocks.prisma.outboundMessage.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ enrollment: { courseId: `curso-${i}` } })),
    );
    const resultado = await recuperarCodigosTecnicosAtascados(AHORA);
    expect(resultado.cursos).toBe(5);
  });

  it("si reprogramar un curso falla, sigue con los demás", async () => {
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([
      { enrollment: { courseId: "curso-a" } },
      { enrollment: { courseId: "curso-b" } },
    ]);
    mocks.rescheduleCourseAutomations
      .mockRejectedValueOnce(new Error("curso-a caído"))
      .mockResolvedValueOnce({});
    const resultado = await recuperarCodigosTecnicosAtascados(AHORA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(2);
    expect(resultado.cursos).toBe(2);
  });

  it("nunca incluye códigos de condición de negocio que siguen vigentes", async () => {
    await recuperarCodigosTecnicosAtascados(AHORA);
    const { where } = mocks.prisma.outboundMessage.findMany.mock.calls[0][0];
    for (const negocio of ["COURSE_AUTOMATIONS_PAUSED", "RULE_PAUSED", "CONTACT_ARCHIVED", "CONTACT_EXCLUDED", "COURSE_NOT_ELIGIBLE"]) {
      expect(where.errorCode.in).not.toContain(negocio);
    }
  });

  it("recupera mensajes viejos que quedaron OMITIDO/HUMAN_HANDOFF_ACTIVE antes del cierre de producción", async () => {
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([{ enrollment: { courseId: "curso-viejo" } }]);
    const resultado = await recuperarCodigosTecnicosAtascados(AHORA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("curso-viejo", AHORA);
    expect(resultado).toEqual({ cursos: 1 });
  });
});
