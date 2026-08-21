// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles de Prisma usan objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findMany: vi.fn(), updateMany: vi.fn() },
    enrollment: { findMany: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
  markCourseAutomationReconcilePending: vi.fn(async () => undefined),
  reconcileCourseDerivedState: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/nurture/course-reconciliation", () => ({
  markCourseAutomationReconcilePending: mocks.markCourseAutomationReconcilePending,
  reconcileCourseDerivedState: mocks.reconcileCourseDerivedState,
}));

import { expirarAtencionesHumanas, recuperarAutomatizacionesDelContacto } from "./handoff-expiry";

const AHORA = new Date("2026-08-19T12:00:00.000Z");
const HACE_30H = new Date("2026-08-18T06:00:00.000Z");
const HACE_2H = new Date("2026-08-19T10:00:00.000Z");
const HACE_1H = new Date("2026-08-19T11:00:00.000Z");
const HACE_25H = new Date("2026-08-18T11:00:00.000Z");

function conversacion(overrides: Partial<{ id: string; leadId: string | null; handoffAt: Date; lastInboundAt: Date | null; lastOutboundAt: Date | null }> = {}) {
  return {
    id: "conv-1",
    leadId: "lead-1",
    handoffAt: HACE_30H,
    lastInboundAt: HACE_30H,
    lastOutboundAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.conversation.findMany.mockResolvedValue([]);
  mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.enrollment.findMany.mockResolvedValue([]);
  mocks.markCourseAutomationReconcilePending.mockResolvedValue(undefined);
  mocks.reconcileCourseDerivedState.mockResolvedValue({ ok: true, startsAt: null, endsAt: null, rescheduled: {}, rulesRefreshed: 0 });
});

/**
 * HUMAN_HANDOFF ya no calla ninguna automatización, pero sigue gobernando la
 * asignación y el Inbox: sin esto, una atención abandonada seguiría
 * mostrándose como atendida por un asesor para siempre si nadie hace clic en
 * "Finalizar atención". Se libera sola pasadas 24 h de INACTIVIDAD real (no
 * 24 h desde que se abrió: `handoffAt` no se mueve mientras dura la
 * atención, así que una conversación con actividad activa hace horas igual
 * tendría un `handoffAt` viejo — cerrarla solo por eso interrumpiría una
 * atención en curso).
 */
describe("expirarAtencionesHumanas", () => {
  it("consulta conversaciones HUMAN_HANDOFF con handoffAt de hace 24h o más (prefiltro), en lotes de 5", async () => {
    await expirarAtencionesHumanas(AHORA);
    expect(mocks.prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { state: "HUMAN_HANDOFF", handoffAt: { lte: new Date("2026-08-18T12:00:00.000Z") } },
      select: { id: true, leadId: true, handoffAt: true, lastInboundAt: true, lastOutboundAt: true },
      take: 5,
    });
  });

  it("sin conversaciones vencidas, no libera ni audita nada", async () => {
    const resultado = await expirarAtencionesHumanas(AHORA);
    expect(resultado).toEqual({ liberadas: 0, cursosReprogramados: 0 });
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("handoff de hace 30h pero con inbound hace 2h: sigue HUMAN_HANDOFF, no se toca", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([conversacion({ handoffAt: HACE_30H, lastInboundAt: HACE_2H, lastOutboundAt: null })]);
    const resultado = await expirarAtencionesHumanas(AHORA);
    expect(resultado).toEqual({ liberadas: 0, cursosReprogramados: 0 });
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("handoff de hace 30h pero con respuesta humana hace 1h: sigue HUMAN_HANDOFF, no se toca", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([conversacion({ handoffAt: HACE_30H, lastInboundAt: HACE_30H, lastOutboundAt: HACE_1H })]);
    const resultado = await expirarAtencionesHumanas(AHORA);
    expect(resultado).toEqual({ liberadas: 0, cursosReprogramados: 0 });
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("sin actividad real en 24h (ni inbound ni respuesta humana reciente): se resuelve, audita y reprograma", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      conversacion({ id: "conv-1", leadId: "lead-1", handoffAt: HACE_30H, lastInboundAt: HACE_25H, lastOutboundAt: null }),
    ]);
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
      metadata: { motivo: "SIN_ACTIVIDAD_24H" },
    }));
    expect(mocks.reconcileCourseDerivedState).toHaveBeenCalledWith("curso-a", null, AHORA);
    expect(mocks.reconcileCourseDerivedState).toHaveBeenCalledWith("curso-b", null, AHORA);
    // Marca pendiente ANTES de intentar reconciliar, por cada curso.
    expect(mocks.markCourseAutomationReconcilePending).toHaveBeenCalledWith(mocks.prisma, "curso-a", "CONTACT_AUTOMATIONS_RECOVERED");
    expect(mocks.markCourseAutomationReconcilePending).toHaveBeenCalledWith(mocks.prisma, "curso-b", "CONTACT_AUTOMATIONS_RECOVERED");
    expect(resultado).toEqual({ liberadas: 1, cursosReprogramados: 2 });
  });

  it("conversación sin contacto vinculado: se libera y audita, pero no hay curso que reprogramar", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([conversacion({ leadId: null })]);
    const resultado = await expirarAtencionesHumanas(AHORA);
    expect(resultado).toEqual({ liberadas: 1, cursosReprogramados: 0 });
    expect(mocks.prisma.enrollment.findMany).not.toHaveBeenCalled();
  });

  it("reclamo optimista: si otra vuelta ya la resolvió (count 0), no se audita ni se reprograma", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([conversacion()]);
    mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

    const resultado = await expirarAtencionesHumanas(AHORA);

    expect(resultado).toEqual({ liberadas: 0, cursosReprogramados: 0 });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
    expect(mocks.reconcileCourseDerivedState).not.toHaveBeenCalled();
  });

  it("varias conversaciones vencidas se procesan todas, cada una con su propio reclamo", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      conversacion({ id: "conv-1", leadId: "lead-1" }),
      conversacion({ id: "conv-2", leadId: "lead-2" }),
    ]);
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ courseId: "curso-a" }]);

    const resultado = await expirarAtencionesHumanas(AHORA);

    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledTimes(2);
    expect(resultado.liberadas).toBe(2);
  });

  it("de dos candidatas, solo la realmente inactiva se resuelve", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      conversacion({ id: "conv-activa", lastInboundAt: HACE_1H }),
      conversacion({ id: "conv-abandonada", lastInboundAt: HACE_30H }),
    ]);

    const resultado = await expirarAtencionesHumanas(AHORA);

    expect(resultado.liberadas).toBe(1);
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "conv-abandonada", state: "HUMAN_HANDOFF" } }),
    );
  });
});

describe("recuperarAutomatizacionesDelContacto", () => {
  it("sin inscripciones, no llama a reprogramar nada", async () => {
    const total = await recuperarAutomatizacionesDelContacto("lead-1", AHORA);
    expect(total).toBe(0);
    expect(mocks.reconcileCourseDerivedState).not.toHaveBeenCalled();
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

  it("marca cada curso pendiente ANTES de intentar reconciliarlo", async () => {
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ courseId: "curso-a" }]);
    await recuperarAutomatizacionesDelContacto("lead-1", AHORA);
    expect(mocks.markCourseAutomationReconcilePending).toHaveBeenCalledWith(mocks.prisma, "curso-a", "CONTACT_AUTOMATIONS_RECOVERED");
  });

  /**
   * Bug corregido en esta continuación: antes `reprogramados++` se ejecutaba
   * SIEMPRE, incluso cuando el curso fallaba -- quien llamaba (cerrar un
   * handoff, restaurar un contacto) creía que la recuperación había
   * funcionado aunque un curso concreto siguiera atascado.
   */
  it("si un curso falla por completo, NO cuenta como recuperado, pero sigue con los demás en vez de abortar", async () => {
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ courseId: "curso-a" }, { courseId: "curso-b" }]);
    mocks.reconcileCourseDerivedState
      .mockResolvedValueOnce({ ok: false, pending: true })
      .mockResolvedValueOnce({ ok: true, startsAt: null, endsAt: null, rescheduled: {}, rulesRefreshed: 0 });
    const total = await recuperarAutomatizacionesDelContacto("lead-1", AHORA);
    expect(mocks.reconcileCourseDerivedState).toHaveBeenCalledTimes(2);
    expect(total).toBe(1);
  });
});
