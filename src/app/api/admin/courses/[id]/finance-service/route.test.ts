// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: { course: { findUnique: vi.fn(), update: vi.fn() } },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { PATCH } from "./route";

function peticion(courseId: string, body: unknown) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/finance-service`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", title: "Curso", financeServiceId: null });
  mocks.prisma.course.update.mockImplementation(async ({ data }: any) => ({ financeServiceId: data.financeServiceId }));
});

describe("PATCH courses/[id]/finance-service", () => {
  it("vincula un servicio y audita el antes/después", async () => {
    const res = await peticion("course-1", { financeServiceId: "SRV-1", confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({ where: { id: "course-1" }, data: { financeServiceId: "SRV-1" } });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "COURSE_FINANCE_SERVICE_LINKED",
      metadata: expect.objectContaining({ antes: null, despues: "SRV-1" }),
    }));
  });

  it("null desvincula explícitamente (Sin vincular)", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", title: "Curso", financeServiceId: "SRV-1" });
    const res = await peticion("course-1", { financeServiceId: null, confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({ where: { id: "course-1" }, data: { financeServiceId: null } });
  });

  it("sin confirm explícito se rechaza sin tocar la base", async () => {
    const res = await peticion("course-1", { financeServiceId: "SRV-1" });
    expect(res.status).toBe(422);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("un curso inexistente responde 404", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const res = await peticion("curso-fantasma", { financeServiceId: "SRV-1", confirm: true });
    expect(res.status).toBe(404);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("sin sesión válida no toca la base", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion("course-1", { financeServiceId: "SRV-1", confirm: true });
    expect(res.status).toBe(401);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });
});
