// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    lead: { findUnique: vi.fn(), update: vi.fn() },
    course: { findFirst: vi.fn() },
    enrollment: { create: vi.fn() },
    leadEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  writeAudit: vi.fn(async () => undefined),
  requireRole: vi.fn(async () => ({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null })),
  scheduleEnrollmentAutomations: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/nurture/engine", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nurture/engine")>("@/lib/nurture/engine");
  return { ...actual, scheduleEnrollmentAutomations: mocks.scheduleEnrollmentAutomations };
});

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new Request("https://crm.example.test/api/admin/enrollments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId: "lead-1", courseId: "course-1", status: "INSCRITO", confirm: true, ...body }),
  });
}

beforeEach(() => {
  mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-1", stage: "NUEVO" });
  mocks.prisma.course.findFirst.mockResolvedValue({ id: "course-1" });
  mocks.prisma.$transaction.mockImplementation(async (fn: any) => fn({
    enrollment: { create: async () => ({ id: "enrollment-1" }) },
    leadEvent: { create: async () => undefined },
    lead: { update: async () => undefined },
  }));
});

describe("POST /api/admin/enrollments", () => {
  it("devuelve el resumen de programación cuando todo salió bien", async () => {
    mocks.scheduleEnrollmentAutomations.mockResolvedValue({ enqueued: 5, updated: 0, skipped: 2, omitted: 0, activeRules: 5 });
    const response = await POST(request({}));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.scheduling).toEqual({ enqueued: 5, updated: 0, skipped: 2, omitted: 0, reason: null });
    expect(body.warning).toBeNull();
  });

  it("advierte cuando la inscripción se crea sin ningún mensaje", async () => {
    mocks.scheduleEnrollmentAutomations.mockResolvedValue({ enqueued: 0, updated: 0, skipped: 0, omitted: 0, activeRules: 0, reason: "NO_ACTIVE_RULES" });
    const response = await POST(request({}));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.scheduling.reason).toBe("NO_ACTIVE_RULES");
    expect(body.warning).toContain("plan estándar");
  });

  it("audita la ausencia de mensajes con su motivo", async () => {
    mocks.scheduleEnrollmentAutomations.mockResolvedValue({ enqueued: 0, updated: 0, skipped: 3, omitted: 0, activeRules: 5, reason: "NO_APPLICABLE_RULES" });
    await POST(request({}));
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "AUTOMATION_NO_MESSAGES_SCHEDULED",
      result: "FAILURE",
      metadata: expect.objectContaining({ reason: "NO_APPLICABLE_RULES", activeRules: 5 }),
    }));
  });

  it("conserva la inscripción aunque la programación falle", async () => {
    mocks.scheduleEnrollmentAutomations.mockRejectedValue(new Error("base caída"));
    const response = await POST(request({}));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.enrollmentId).toBe("enrollment-1");
    expect(body.scheduling.reason).toBe("SCHEDULING_FAILED");
    expect(body.warning).toContain("no se pudieron programar");
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "AUTOMATION_SCHEDULING_FAILED" }));
  });

  it("advierte cuando los mensajes quedaron omitidos por falta de enlace", async () => {
    mocks.scheduleEnrollmentAutomations.mockResolvedValue({ enqueued: 0, updated: 0, skipped: 0, omitted: 3, activeRules: 5 });
    const body = await (await POST(request({}))).json();
    expect(body.warning).toContain("enlace de transmisión");
  });
});
