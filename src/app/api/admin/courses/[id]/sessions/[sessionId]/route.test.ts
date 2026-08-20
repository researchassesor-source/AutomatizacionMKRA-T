// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    courseSession: { findUnique: vi.fn() },
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    course: { update: vi.fn() },
    courseSession: { update: vi.fn(), delete: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async (_args: any) => ({ count: 0 })), count: vi.fn(async (_args: any) => 0) },
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

import { DELETE, PATCH } from "./route";

const SESSION_VALIDA = { startAt: "2026-09-01T15:00:00.000Z", streamUrl: "https://meet.example.test/sala" };

function patch(courseId: string, sessionId: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId, sessionId }) },
  );
}

function del(courseId: string, sessionId: string, body: Record<string, unknown> = { confirm: true }) {
  return DELETE(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId, sessionId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.courseSession.findUnique.mockResolvedValue({ courseId: "course-1", startAt: new Date("2026-08-20T15:00:00.000Z") });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", startsAt: null, endsAt: null, streamUrl: null, sessions: [] });
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.tx.course.update.mockResolvedValue({ id: "course-1" });
  mocks.tx.courseSession.update.mockResolvedValue({ id: "session-1", startAt: new Date(SESSION_VALIDA.startAt), streamUrl: SESSION_VALIDA.streamUrl });
  mocks.tx.courseSession.delete.mockResolvedValue({ id: "session-1" });
  mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.outboundMessage.count.mockResolvedValue(0);
  mocks.rescheduleCourseAutomations.mockResolvedValue({});
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
});

/**
 * Sección E del release de estabilización: sessions/[sessionId] no tenía la
 * misma protección atómica que ya se le dio a la reconciliación de calendario
 * de WordPress (schedule-proposal). Un PATCH podía dejar un mensaje ya
 * renderizado con la fecha/enlace viejos si un envío caía justo antes del
 * recálculo, y un DELETE podía dejar un PROGRAMADO con courseSessionId=null
 * (onDelete:SetNull) que rescheduleCourseAutomations nunca vuelve a tocar.
 *
 * Continuación posterior: el alcance de la cuarentena se amplió al CURSO
 * entero (no solo `courseSessionId: sessionId`). Mover o quitar una sesión
 * desplaza "sesión X de Y" para las que NO se tocaron directamente
 * (`resolveCourseSessions` asigna esos números por orden cronológico de
 * TODAS las sesiones), así que cuarentenar solo la sesión tocada dejaba
 * mensajes de sesiones hermanas con un texto que ya no describe el
 * calendario real.
 */
describe("PATCH sessions/[sessionId]: cuarentena antes de mover fecha/enlace", () => {
  it("pone en cuarentena lo recuperable del CURSO entero, ANTES de guardar, en la misma transacción", async () => {
    const orden: string[] = [];
    mocks.tx.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cuarentena"); return { count: 3 }; });
    mocks.tx.courseSession.update.mockImplementation(async () => { orden.push("guardar"); return { id: "session-1", startAt: new Date(SESSION_VALIDA.startAt), streamUrl: null }; });

    const res = await patch("course-1", "session-1", SESSION_VALIDA);
    const body = await res.json();

    expect(orden).toEqual(["cuarentena", "guardar"]);
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { enrollment: { courseId: "course-1" }, origin: "AUTOMATION", status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "SCHEDULE_RECONCILING", nextAttemptAt: null }),
    });
    expect(body.quarantined).toBe(3);
  });

  it("SÍ alcanza a otras sesiones del mismo curso, no solo a la que cambió (corrige el desplazamiento de 'sesión X de Y')", async () => {
    await patch("course-1", "session-1", SESSION_VALIDA);
    const { where } = mocks.tx.outboundMessage.updateMany.mock.calls[0][0];
    expect(where).not.toHaveProperty("courseSessionId");
    expect(where.enrollment.courseId).toBe("course-1");
  });

  it("marca el curso pendiente de reconciliación dentro de la misma transacción", async () => {
    await patch("course-1", "session-1", SESSION_VALIDA);
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "SESSION_UPDATED" },
    });
  });

  it("después de guardar, reprograma el curso", async () => {
    await patch("course-1", "session-1", SESSION_VALIDA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });

  it("si el recálculo falla dos veces, la respuesta igual confirma que la sesión se guardó, marcada pendiente", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto caída"));
    const res = await patch("course-1", "session-1", SESSION_VALIDA);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, pending: true });
    expect(JSON.stringify(body)).not.toMatch(/secreto/);
  });

  it("una sesión de otro curso responde 404 y no toca nada", async () => {
    mocks.prisma.courseSession.findUnique.mockResolvedValue({ courseId: "otro-curso", startAt: new Date() });
    const res = await patch("course-1", "session-1", SESSION_VALIDA);
    expect(res.status).toBe(404);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("datos inválidos se rechazan sin abrir transacción", async () => {
    const res = await patch("course-1", "session-1", { startAt: "no-es-fecha" });
    expect(res.status).toBe(422);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("DELETE sessions/[sessionId]: cancela ANTES de borrar, nunca deja un PROGRAMADO huérfano", () => {
  it("cancela los pendientes de la sesión ANTES de borrarla, en la misma transacción", async () => {
    const orden: string[] = [];
    mocks.tx.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cancelar-o-cuarentenar"); return { count: 2 }; });
    mocks.tx.courseSession.delete.mockImplementation(async () => { orden.push("borrar"); return { id: "session-1" }; });

    const res = await del("course-1", "session-1");
    const body = await res.json();

    expect(orden[0]).toBe("cancelar-o-cuarentenar");
    expect(orden).toContain("borrar");
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { courseSessionId: "session-1", status: { in: ["PROGRAMADO", "OMITIDO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "CANCELADO", errorCode: "SESSION_REMOVED" }),
    });
    expect(body.cancelled).toBe(2);
  });

  it("además cuarentena (recuperable) lo que depende del calendario en el RESTO del curso, no solo cancela lo de la sesión borrada", async () => {
    await del("course-1", "session-1");
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { enrollment: { courseId: "course-1" }, origin: "AUTOMATION", status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "SCHEDULE_RECONCILING" }),
    });
  });

  it("cuenta los mensajes ya enviados para conservarlos como historial, sin cancelarlos", async () => {
    mocks.tx.outboundMessage.count.mockResolvedValue(5);
    const res = await del("course-1", "session-1");
    const body = await res.json();
    expect(mocks.tx.outboundMessage.count).toHaveBeenCalledWith({
      where: { courseSessionId: "session-1", status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO", "SIMULADO"] } },
    });
    expect(body.preservedMessages).toBe(5);
  });

  it("la cancelación de la sesión borrada también barre lo que ya estaba en cuarentena (OMITIDO) de esa sesión", async () => {
    await del("course-1", "session-1");
    const cancelacion = mocks.tx.outboundMessage.updateMany.mock.calls.find(([arg]: any) => arg.where.courseSessionId === "session-1");
    expect(cancelacion?.[0].where.status.in).toContain("OMITIDO");
  });

  it("marca el curso pendiente de reconciliación dentro de la misma transacción", async () => {
    await del("course-1", "session-1");
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "SESSION_DELETED" },
    });
  });

  it("sin confirm se rechaza y no borra nada", async () => {
    const res = await del("course-1", "session-1", {});
    expect(res.status).toBe(422);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("después de borrar, reprograma el curso", async () => {
    await del("course-1", "session-1");
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });
});
