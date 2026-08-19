// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    courseSession: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    courseSession: { update: vi.fn(), delete: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async (_args: any) => ({ count: 0 })), count: vi.fn(async (_args: any) => 0) },
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
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.tx.courseSession.update.mockResolvedValue({ id: "session-1", startAt: new Date(SESSION_VALIDA.startAt), streamUrl: SESSION_VALIDA.streamUrl });
  mocks.tx.courseSession.delete.mockResolvedValue({ id: "session-1" });
  mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.outboundMessage.count.mockResolvedValue(0);
  mocks.rescheduleCourseAutomations.mockResolvedValue({});
});

/**
 * Sección E del release de estabilización: sessions/[sessionId] no tenía la
 * misma protección atómica que ya se le dio a la reconciliación de calendario
 * de WordPress (schedule-proposal). Un PATCH podía dejar un mensaje ya
 * renderizado con la fecha/enlace viejos si un envío caía justo antes del
 * recálculo, y un DELETE podía dejar un PROGRAMADO con courseSessionId=null
 * (onDelete:SetNull) que rescheduleCourseAutomations nunca vuelve a tocar.
 */
describe("PATCH sessions/[sessionId]: cuarentena antes de mover fecha/enlace", () => {
  it("pone en cuarentena los pendientes de ESTA sesión, ANTES de guardar, en la misma transacción", async () => {
    const orden: string[] = [];
    mocks.tx.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cuarentena"); return { count: 3 }; });
    mocks.tx.courseSession.update.mockImplementation(async () => { orden.push("guardar"); return { id: "session-1", startAt: new Date(SESSION_VALIDA.startAt), streamUrl: null }; });

    const res = await patch("course-1", "session-1", SESSION_VALIDA);
    const body = await res.json();

    expect(orden).toEqual(["cuarentena", "guardar"]);
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { courseSessionId: "session-1", status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "SCHEDULE_RECONCILING", nextAttemptAt: null }),
    });
    expect(body.quarantined).toBe(3);
  });

  it("no toca los pendientes de OTRAS sesiones del mismo curso", async () => {
    await patch("course-1", "session-1", SESSION_VALIDA);
    const { where } = mocks.tx.outboundMessage.updateMany.mock.calls[0][0];
    expect(where.courseSessionId).toBe("session-1");
  });

  it("después de guardar, reprograma el curso", async () => {
    await patch("course-1", "session-1", SESSION_VALIDA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");
  });

  it("si el recálculo falla, la respuesta igual confirma que la sesión se guardó", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto caída"));
    const res = await patch("course-1", "session-1", SESSION_VALIDA);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, rescheduled: null });
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
    mocks.tx.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cancelar"); return { count: 2 }; });
    mocks.tx.courseSession.delete.mockImplementation(async () => { orden.push("borrar"); return { id: "session-1" }; });

    const res = await del("course-1", "session-1");
    const body = await res.json();

    expect(orden).toEqual(["cancelar", "borrar"]);
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { courseSessionId: "session-1", status: { in: ["PROGRAMADO", "OMITIDO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "CANCELADO", errorCode: "SESSION_REMOVED" }),
    });
    expect(body.cancelled).toBe(2);
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

  it("la cancelación también barre lo que ya estaba en cuarentena (OMITIDO) de esta sesión", async () => {
    await del("course-1", "session-1");
    const { where } = mocks.tx.outboundMessage.updateMany.mock.calls[0][0];
    expect(where.status.in).toContain("OMITIDO");
  });

  it("sin confirm se rechaza y no borra nada", async () => {
    const res = await del("course-1", "session-1", {});
    expect(res.status).toBe(422);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("después de borrar, reprograma el curso", async () => {
    await del("course-1", "session-1");
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");
  });
});
