// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles de Prisma usan objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: {
    automationRule: { findUnique: vi.fn(), update: vi.fn() },
    course: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async () => ({ count: 0 })) },
  },
  rescheduleCourseAutomations: vi.fn(async () => ({ enrollments: 0, enqueued: 0, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false })),
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { PATCH } from "./route";

const RULE_BASE = {
  id: "rule-1",
  courseId: "course-1",
  campaignId: null,
  name: "Bienvenida",
  trigger: "ON_REGISTRATION" as const,
  offsetMinutes: 0,
  channel: "EMAIL" as const,
  subject: "Hola",
  body: "Hola {{nombre}}",
  status: "ACTIVE" as const,
  requiresStreamUrl: false,
  enrollmentStatuses: ["INTERESADO", "INSCRITO"] as const,
};

function request(body: unknown) {
  return new Request("https://crm.example.test/api/admin/automations/rule-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ id: "rule-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", startsAt: null, endsAt: null, streamUrl: null, sessions: [] });
  mocks.prisma.automationRule.update.mockImplementation(async ({ data }: any) => ({ ...RULE_BASE, ...data }));
});

/**
 * Requisito 33/40-E del release de estabilización: editar una regla que YA
 * está ACTIVE (texto, horario) nunca debe mover `activatedAt`. Es justo lo
 * que rompía comparar contra `updatedAt`: cualquier edición reenamoraba la
 * fecha y podía silenciar la bienvenida de inscripciones anteriores.
 */
describe("PATCH automations/[id]: activatedAt solo se mueve en una activación real", () => {
  it("editar el asunto de una regla ya ACTIVE no toca activatedAt", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    const res = await PATCH(request({ ...RULE_BASE, subject: "Asunto corregido", confirm: true }), params());
    expect(res.status).toBe(200);
    const data = mocks.prisma.automationRule.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("activatedAt");
  });

  it("PAUSED -> ACTIVE (reactivación real) sí fija activatedAt", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "PAUSED" });
    await PATCH(request({ ...RULE_BASE, status: "ACTIVE", confirm: true }), params());
    const data = mocks.prisma.automationRule.update.mock.calls[0][0].data;
    expect(data.activatedAt).toBeInstanceOf(Date);
  });

  it("ACTIVE -> PAUSED no fija activatedAt (no es una activación)", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "PAUSED", confirm: true }), params());
    const data = mocks.prisma.automationRule.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("activatedAt");
  });

  it("reenviar status:ACTIVE sobre una regla que ya estaba ACTIVE no lo cuenta como activación", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "ACTIVE", confirm: true }), params());
    const data = mocks.prisma.automationRule.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("activatedAt");
  });
});

describe("PATCH automations/[id]: pausa reversible vs archivado definitivo", () => {
  it("pasar a PAUSED pone los mensajes PROGRAMADO en OMITIDO/RULE_PAUSED, no CANCELADO", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "PAUSED", confirm: true }), params());
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { automationRuleId: "rule-1", status: "PROGRAMADO" },
      data: { status: "OMITIDO", errorCode: "RULE_PAUSED", errorMessage: expect.any(String) },
    });
  });

  it("pasar a ARCHIVED sí cancela los PROGRAMADO (cierre, no pausa)", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "ARCHIVED", confirm: true }), params());
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { automationRuleId: "rule-1", status: "PROGRAMADO" },
      data: { status: "CANCELADO", cancelledAt: expect.any(Date), errorCode: "AUTOMATION_DISABLED", errorMessage: expect.any(String) },
    });
  });

  it("reprograma el curso cuando el resultado queda ACTIVE, nunca si queda PAUSED", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "PAUSED" });
    await PATCH(request({ ...RULE_BASE, status: "ACTIVE", confirm: true }), params());
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");

    mocks.rescheduleCourseAutomations.mockClear();
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "PAUSED", confirm: true }), params());
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });
});
