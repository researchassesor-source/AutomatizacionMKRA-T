// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findMany: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    automationRule: { updateMany: vi.fn() },
    conversation: { findUnique: vi.fn(async () => null) },  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { diagnosePausedAutomations, recoverPausedAutomations } from "./automation-pause-diagnostics";

const FUTURE = new Date("2027-01-15T14:00:00.000Z");

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    name: "Recordatorio 24 horas antes",
    channel: "EMAIL",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 1440,
    subject: "Mañana nos vemos",
    body: "Contenido",
    planKey: "reminder_24h",
    updatedAt: new Date("2026-08-06T10:00:00.000Z"),
    ...overrides,
  };
}

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: "course-1",
    title: "Desarrollo Profesional en Marketing",
    slug: "marketing",
    externalId: "2287",
    externalSource: "wordpress",
    isPublished: true,
    // Taller gratuito: el derecho de acceso lo concede el registro.
    isFree: true,
    acceptsRegistrations: false,
    syncStatus: "SYNCED",
    startsAt: null,
    endsAt: null,
    streamUrl: "https://meet.example.com/sala",
    sessions: [{ id: "s1", title: null, startAt: FUTURE, endAt: null, streamUrl: null }],
    automationRules: [rule()],
    _count: { enrollments: 12 },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.prisma.auditLog.findFirst.mockResolvedValue({ createdAt: new Date("2026-08-06T09:00:00.000Z") });
  mocks.prisma.automationRule.updateMany.mockImplementation(async ({ where }: any) => ({ count: where.id.in.length }));
});

describe("diagnóstico de reglas pausadas", () => {
  it("marca como recuperable una regla de curso vigente con registro cerrado", async () => {
    // Este es exactamente el caso de las 60 reglas: curso publicado, cupo
    // cerrado y calendario en sesiones.
    mocks.prisma.course.findMany.mockResolvedValue([course()]);
    const report = await diagnosePausedAutomations();
    expect(report.pausedRules).toBe(1);
    expect(report.recoverableRules).toBe(1);
    expect(report.courses[0].rules[0].reason).toBe("RECOVERABLE");
  });

  it("reconoce el calendario que vive solo en las sesiones", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course({ startsAt: null, sessions: [{ id: "s1", title: null, startAt: FUTURE, endAt: null, streamUrl: null }] })]);
    const report = await diagnosePausedAutomations();
    expect(report.courses[0].hasSchedule).toBe(true);
    expect(report.courses[0].rules[0].recoverable).toBe(true);
  });

  it("no considera recuperable un curso despublicado", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course({ isPublished: false })]);
    const report = await diagnosePausedAutomations();
    expect(report.recoverableRules).toBe(0);
    expect(report.courses[0].rules[0].reason).toBe("COURSE_UNPUBLISHED");
  });

  it("no considera recuperable un curso histórico", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course({ isPublished: false, syncStatus: "HISTORICAL" })]);
    const report = await diagnosePausedAutomations();
    expect(report.courses[0].rules[0].reason).toBe("COURSE_HISTORICAL");
  });

  it("no considera recuperable un curso sin ninguna fecha", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course({ startsAt: null, sessions: [] })]);
    const report = await diagnosePausedAutomations();
    expect(report.courses[0].rules[0].reason).toBe("COURSE_WITHOUT_SCHEDULE");
    expect(report.courses[0].hasSchedule).toBe(false);
  });

  it("no considera recuperable una regla sin asunto", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course({ automationRules: [rule({ subject: "  " })] })]);
    const report = await diagnosePausedAutomations();
    expect(report.courses[0].rules[0].reason).toBe("RULE_TEMPLATE_INVALID");
  });

  it("es de solo lectura: no modifica ninguna regla", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course()]);
    await diagnosePausedAutomations();
    expect(mocks.prisma.automationRule.updateMany).not.toHaveBeenCalled();
  });
});

describe("recuperación controlada", () => {
  it("reactiva solo las reglas recuperables", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([
      course(),
      course({ id: "course-2", title: "Curso despublicado", isPublished: false, automationRules: [rule({ id: "rule-2" })] }),
    ]);
    const result = await recoverPausedAutomations(null);
    expect(result.reactivated).toBe(1);
    expect(result.courses).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mocks.prisma.automationRule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["rule-1"] }, status: "PAUSED" }, data: { status: "ACTIVE", activatedAt: expect.any(Date) } }),
    );
  });

  it("no toca nada cuando no hay reglas pausadas por error", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course({ isPublished: false })]);
    const result = await recoverPausedAutomations(null);
    expect(result.reactivated).toBe(0);
    expect(mocks.prisma.automationRule.updateMany).not.toHaveBeenCalled();
  });

  it("es idempotente: la segunda pasada no encuentra nada", async () => {
    mocks.prisma.course.findMany.mockResolvedValueOnce([course()]);
    await recoverPausedAutomations(null);
    // Ya reactivada: deja de aparecer en el listado de pausadas.
    mocks.prisma.course.findMany.mockResolvedValue([]);
    const second = await recoverPausedAutomations(null);
    expect(second.reactivated).toBe(0);
    expect(mocks.prisma.automationRule.updateMany).toHaveBeenCalledTimes(1);
  });

  it("permite limitar la recuperación a un curso", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([
      course(),
      course({ id: "course-2", automationRules: [rule({ id: "rule-2" })] }),
    ]);
    const result = await recoverPausedAutomations(null, { courseId: "course-2" });
    expect(result.details).toEqual([{ courseId: "course-2", courseTitle: "Desarrollo Profesional en Marketing", ruleIds: ["rule-2"] }]);
  });

  it("solo cambia el estado y la activación: conserva textos y configuración", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course()]);
    await recoverPausedAutomations(null);
    const call = mocks.prisma.automationRule.updateMany.mock.calls[0][0];
    expect(Object.keys(call.data).sort()).toEqual(["activatedAt", "status"]);
    expect(call.data.activatedAt).toBeInstanceOf(Date);
  });

  it("deja auditoría de la recuperación con su causa", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([course()]);
    await recoverPausedAutomations(null);
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "AUTOMATION_RULES_RECOVERED",
      metadata: expect.objectContaining({ reactivated: 1 }),
    }));
  });
});
