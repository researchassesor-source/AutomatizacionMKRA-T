// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles de Prisma usan objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findMany: vi.fn(), updateMany: vi.fn() },
    enrollment: { findMany: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
  rescheduleCourseAutomations: vi.fn(async () => ({})),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));

import { expirarAtencionesHumanas, recuperarAutomatizacionesDelContacto } from "./handoff-expiry";

const AHORA = new Date("2026-08-19T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.conversation.findMany.mockResolvedValue([]);
  mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.enrollment.findMany.mockResolvedValue([]);
  mocks.rescheduleCourseAutomations.mockResolvedValue({});
});

/**
 * Sección 38 del release de estabilización: HUMAN_HANDOFF callaba lo
 * comercial de un contacto para siempre si nadie hacía clic en "Cerrar
 * atención". Se libera sola pasadas 24 h desde que se abrió, igual que la
 * ventana de servicio de WhatsApp.
 */
describe("expirarAtencionesHumanas", () => {
  it("consulta solo conversaciones HUMAN_HANDOFF con handoffAt de hace 24h o más, en lotes de 5", async () => {
    await expirarAtencionesHumanas(AHORA);
    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { state: "HUMAN_HANDOFF", handoffAt: { lte: new Date("2026-08-18T12:00:00.000Z") } },
      select: { id: true, leadId: true },
      take: 5,
    });
  });

  it("sin conversaciones vencidas, no libera ni audita nada", async () => {
    const resultado = await expirarAtencionesHumanas(AHORA);
    expect(resultado).toEqual({ liberadas: 0, cursosReprogramados: 0 });
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("una conversación vencida se resuelve, se audita como automática y reprograma los cursos del contacto", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([{ id: "conv-1", leadId: "lead-1" }]);
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ courseId: "curso-a" }, { courseId: "curso-b" }]);

    const resultado = await expirarAtencionesHumanas(AHORA);

    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv-1", state: "HUMAN_HANDOFF" },
      data: { state: "RESOLVED", resolvedAt: AHORA, resolvedBy: "automation" },
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "WHATSAPP_HANDOFF_AUTO_RESOLVED",
      entityType: "Conversation",
      entityId: "conv-1",
      actorEmail: "automation",
    }));
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("curso-a", AHORA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("curso-b", AHORA);
    expect(resultado).toEqual({ liberadas: 1, cursosReprogramados: 2 });
  });

  it("conversación sin contacto vinculado: se libera y audita, pero no hay curso que reprogramar", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([{ id: "conv-1", leadId: null }]);
    const resultado = await expirarAtencionesHumanas(AHORA);
    expect(resultado).toEqual({ liberadas: 1, cursosReprogramados: 0 });
    expect(mocks.prisma.enrollment.findMany).not.toHaveBeenCalled();
  });

  it("reclamo optimista: si otra vuelta ya la resolvió (count 0), no se audita ni se reprograma", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([{ id: "conv-1", leadId: "lead-1" }]);
    mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    const resultado = await expirarAtencionesHumanas(AHORA);

    expect(resultado).toEqual({ liberadas: 0, cursosReprogramados: 0 });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("varias conversaciones vencidas se procesan todas, cada una con su propio reclamo", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      { id: "conv-1", leadId: "lead-1" },
      { id: "conv-2", leadId: "lead-2" },
    ]);
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ courseId: "curso-a" }]);

    const resultado = await expirarAtencionesHumanas(AHORA);

    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledTimes(2);
    expect(resultado.liberadas).toBe(2);
  });
});

describe("recuperarAutomatizacionesDelContacto", () => {
  it("sin inscripciones, no llama a reprogramar nada", async () => {
    const total = await recuperarAutomatizacionesDelContacto("lead-1", AHORA);
    expect(total).toBe(0);
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("reprograma cada curso distinto en el que el contacto tiene inscripción", async () => {
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ courseId: "curso-a" }, { courseId: "curso-b" }]);
    const total = await recuperarAutomatizacionesDelContacto("lead-1", AHORA);
    expect(mocks.prisma.enrollment.findMany).toHaveBeenCalledWith({
      where: { leadId: "lead-1" },
      distinct: ["courseId"],
      select: { courseId: true },
    });
    expect(total).toBe(2);
  });

  it("si reprogramar un curso falla, sigue con los demás en vez de abortar", async () => {
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ courseId: "curso-a" }, { courseId: "curso-b" }]);
    mocks.rescheduleCourseAutomations
      .mockRejectedValueOnce(new Error("curso-a caído"))
      .mockResolvedValueOnce({});
    const total = await recuperarAutomatizacionesDelContacto("lead-1", AHORA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(2);
    expect(total).toBe(2);
  });
});
