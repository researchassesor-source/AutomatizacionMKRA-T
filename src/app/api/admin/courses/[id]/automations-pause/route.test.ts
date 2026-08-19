// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn() },
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
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));

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
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.tx.course.update.mockImplementation(async ({ data }: any) => ({ automationsPausedAt: data.automationsPausedAt, automationsPausedBy: data.automationsPausedBy }));
  mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
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
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");
  });

  it("si la reprogramación al reanudar falla, la respuesta igual confirma la reanudación", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto conexión perdida"));
    const res = await patch("course-1", { paused: false, confirm: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, pausado: false });
  });
});
