// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn() },
    courseSession: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    course: { update: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async (_args: any) => ({ count: 0 })) },
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
  mocks.prisma.courseSession.create.mockResolvedValue({ id: "session-1", startAt: new Date("2026-09-01T15:00:00.000Z"), streamUrl: null });
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.tx.course.update.mockResolvedValue({ id: "course-1" });
  mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.rescheduleCourseAutomations.mockResolvedValue({});
});

describe("POST sessions: crear no necesita cuarentena, pero un fallo de recálculo no debe ocultar la creación", () => {
  it("crea la sesión y reprograma", async () => {
    const res = await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    expect(res.status).toBe(201);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");
  });

  it("si el recálculo falla, la sesión sigue creada y la respuesta lo explica", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto caída"));
    const res = await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.session).toBeDefined();
    expect(body.rescheduled).toBeNull();
    expect(body.warning).toMatch(/pendiente/i);
  });

  it("sin warning cuando el recálculo funciona", async () => {
    const res = await post("course-1", { startAt: "2026-09-01T15:00:00.000Z" });
    const body = await res.json();
    expect(body.warning).toBeUndefined();
  });
});

describe("PATCH sessions (enlace por defecto del curso): misma protección que un enlace de sesión", () => {
  it("pone en cuarentena, ANTES de guardar, los pendientes de reglas con requiresStreamUrl", async () => {
    const orden: string[] = [];
    mocks.tx.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cuarentena"); return { count: 2 }; });
    mocks.tx.course.update.mockImplementation(async () => { orden.push("guardar"); return { id: "course-1" }; });

    const res = await patch("course-1", { streamUrl: "https://meet.example.test/nuevo" });
    const body = await res.json();

    expect(orden).toEqual(["cuarentena", "guardar"]);
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

  it("después de guardar, reprograma el curso", async () => {
    await patch("course-1", { streamUrl: "https://meet.example.test/nuevo" });
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");
  });

  it("quitar el enlace (cadena vacía) también pasa por la misma protección", async () => {
    await patch("course-1", { streamUrl: "" });
    expect(mocks.tx.course.update).toHaveBeenCalledWith({ where: { id: "course-1" }, data: { streamUrl: null } });
  });
});
