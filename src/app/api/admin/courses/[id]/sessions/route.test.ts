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
    courseSession: { create: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async (_args: any) => ({ count: 0 })) },
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

import { PATCH, POST } from "./route";

function post(courseId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId }) },
  );
}

function patch(courseId: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/sessions`, {
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
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.tx.course.update.mockResolvedValue({ id: "course-1" });
  mocks.tx.courseSession.create.mockResolvedValue({ id: "session-1", startAt: new Date("2026-09-01T15:00:00.000Z"), streamUrl: null });
  mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.rescheduleCourseAutomations.mockResolvedValue({});
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
});

describe("POST sessions: agregar una sesión también recalcula lo que ya existía", () => {
  it("crea la sesión y reconcilia el curso", async () => {
    const res = await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    expect(res.status).toBe(201);
    expect(mocks.tx.courseSession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ courseId: "course-1" }) });
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });

  it("agregar una sesión pone en cuarentena lo que ya existía del curso (totalSessions cambia para todas)", async () => {
    await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { enrollment: { courseId: "course-1" }, origin: "AUTOMATION", status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "SCHEDULE_RECONCILING" }),
    });
  });

  it("la cuarentena ocurre antes de crear la sesión, en la misma transacción", async () => {
    const orden: string[] = [];
    mocks.tx.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cuarentena"); return { count: 1 }; });
    mocks.tx.courseSession.create.mockImplementation(async () => { orden.push("crear"); return { id: "session-1", startAt: new Date("2026-09-01T15:00:00.000Z"), streamUrl: null }; });
    await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    expect(orden).toEqual(["cuarentena", "crear"]);
  });

  it("marca el curso pendiente de reconciliación dentro de la misma transacción", async () => {
    await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "SESSION_CREATED" },
    });
  });

  it("si el recálculo falla dos veces, la sesión sigue creada y la respuesta lo marca pendiente (el cron lo recupera)", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto caída"));
    const res = await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.session).toBeDefined();
    expect(body.pending).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secreto/);
  });

  it("sin pending cuando el recálculo funciona", async () => {
    const res = await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    const body = await res.json();
    expect(body.pending).toBe(false);
  });
});

describe("PATCH sessions (enlace por defecto del curso): misma protección que un enlace de sesión", () => {
  it("pone en cuarentena, ANTES de guardar, los pendientes de reglas con requiresStreamUrl", async () => {
    const orden: string[] = [];
    mocks.tx.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cuarentena"); return { count: 2 }; });
    mocks.tx.course.update.mockImplementation(async () => { orden.push("guardar"); return { id: "course-1" }; });

    const res = await patch("course-1", { streamUrl: "https://meet.example.test/nuevo" });
    const body = await res.json();

    // "guardar" aparece dos veces: la escritura del streamUrl y, en la misma
    // transacción, la marca de reconciliación pendiente -ambas pasan por
    // tx.course.update-.
    expect(orden).toEqual(["cuarentena", "guardar", "guardar"]);
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: {
        enrollment: { courseId: "course-1" },
        automationRule: { requiresStreamUrl: true },
        status: { in: ["PROGRAMADO", "FALLIDO"] },
      },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "SCHEDULE_RECONCILING" }),
    });
    expect(body.quarantined).toBe(2);
  });

  it("marca el curso pendiente de reconciliación dentro de la misma transacción", async () => {
    await patch("course-1", { streamUrl: "https://meet.example.test/nuevo" });
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { streamUrl: "https://meet.example.test/nuevo" },
    });
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "STREAM_URL_CHANGED" },
    });
  });

  it("después de guardar, reprograma el curso", async () => {
    await patch("course-1", { streamUrl: "https://meet.example.test/nuevo" });
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });

  it("quitar el enlace (cadena vacía) también pasa por la misma protección", async () => {
    await patch("course-1", { streamUrl: "" });
    expect(mocks.tx.course.update).toHaveBeenCalledWith({ where: { id: "course-1" }, data: { streamUrl: null } });
  });
});
