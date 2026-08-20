// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    course: { update: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async () => ({ count: 0 })) },
  },
  writeAudit: vi.fn(async () => undefined),
  requireRole: vi.fn(async () => ({
    session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" },
    error: null,
  })),
  rescheduleCourseAutomations: vi.fn(async () => ({})),
  reprogramarOfertaAutomatica: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));
vi.mock("@/lib/commerce/offer-campaign", () => ({ reprogramarOfertaAutomatica: mocks.reprogramarOfertaAutomatica }));

import { PATCH } from "./route";

function patch(courseId: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/automations-pause`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", title: "Curso de prueba", automationsPausedAt: null });
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.tx.course.update.mockImplementation(async ({ data }: any) =>
    "automationsPausedAt" in data ? { automationsPausedAt: data.automationsPausedAt, automationsPausedBy: data.automationsPausedBy } : {});
  mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.rescheduleCourseAutomations.mockResolvedValue({});
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
});

/**
 * Sección 36: reanudar un curso debe recuperar lo que el cerrojo de último
 * momento en sendMessage haya dejado en OMITIDO/COURSE_AUTOMATIONS_PAUSED
 * mientras duró la pausa. Sin esto, un mensaje pausado se quedaría pausado
 * para siempre aunque el curso ya no lo estuviera.
 */
describe("PATCH automations-pause", () => {
  it("pausar NO reprograma nada: solo reanudar recupera lo pendiente", async () => {
    const res = await patch("course-1", { paused: true, confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("pausar pone en cuarentena PROGRAMADO/FALLIDO del curso EN LA MISMA transacción que marca la pausa", async () => {
    mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 4 });
    const res = await patch("course-1", { paused: true, confirm: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ enrollment: { courseId: "course-1" }, status: { in: ["PROGRAMADO", "FALLIDO"] } }),
        data: expect.objectContaining({ status: "OMITIDO", errorCode: "COURSE_AUTOMATIONS_PAUSED", nextAttemptAt: null }),
      }),
    );
    expect(body.quarantined).toBe(4);
  });

  it("reanudar NO pone nada en cuarentena", async () => {
    await patch("course-1", { paused: false, confirm: true });
    expect(mocks.tx.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  it("reanudar reprograma el curso para recuperar lo que quedó omitido por la pausa", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", title: "Curso de prueba", automationsPausedAt: new Date("2026-08-09T00:00:00.000Z") });
    const res = await patch("course-1", { paused: false, confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });

  it("reanudar marca el curso pendiente de reconciliación dentro de la misma transacción que lo reanuda", async () => {
    await patch("course-1", { paused: false, confirm: true });
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "COURSE_RESUMED" },
    });
  });

  it("pausar NO marca pendiente de reconciliación: ya se protegió la cola arriba", async () => {
    await patch("course-1", { paused: true, confirm: true });
    const marcasPendientes = mocks.tx.course.update.mock.calls.filter(([arg]: any) => "automationReconcilePendingAt" in arg.data);
    expect(marcasPendientes).toHaveLength(0);
  });

  it("si la reprogramación al reanudar falla dos veces, la respuesta igual confirma la reanudación, marcada pendiente", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto conexión perdida"));
    const res = await patch("course-1", { paused: false, confirm: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, pausado: false, pending: true });
    expect(JSON.stringify(body)).not.toMatch(/secreto/);
  });
});
