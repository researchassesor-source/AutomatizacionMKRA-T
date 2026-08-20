// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
  },
  rescheduleCourseAutomations: vi.fn(),
  reprogramarOfertaAutomatica: vi.fn(),
  writeAudit: vi.fn(async (_input: any) => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("./engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));
vi.mock("@/lib/commerce/offer-campaign", () => ({ reprogramarOfertaAutomatica: mocks.reprogramarOfertaAutomatica }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { markCourseAutomationReconcilePending, reconcileCourseDerivedState, recuperarReconciliacionesPendientes } from "./course-reconciliation";

/**
 * Reconciliación derivada persistente de un curso (problema arquitectónico
 * único de esta continuación): antes, si rescheduleCourseAutomations fallaba
 * tras un cambio real ya guardado, el único rastro era un `.catch(() =>
 * null)` -- nada volvía a intentarlo si nadie más tocaba ese curso. Estas
 * pruebas cubren que el flag persistente sobrevive el fallo, que el paquete
 * completo (fechas, cola, nextExecutionAt, oferta #12) se trata como una
 * unidad, y que nunca se propaga un error crudo ni se limpia el flag sin
 * éxito total.
 */
const AHORA = new Date("2026-08-20T12:00:00.000Z");
const RESCHEDULE_VACIO = { enrollments: 0, enqueued: 0, updated: 0, omitted: 0, cancelled: 0, batches: 0, truncated: false, nextCursor: null };

function curso(overrides: Partial<{ startsAt: Date | null; endsAt: Date | null; sessions: unknown[] }> = {}) {
  return {
    id: "course-1",
    startsAt: overrides.startsAt === undefined ? new Date("2026-09-01T15:00:00Z") : overrides.startsAt,
    endsAt: overrides.endsAt === undefined ? new Date("2026-09-01T17:00:00Z") : overrides.endsAt,
    streamUrl: null,
    sessions: overrides.sessions ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.course.findUnique.mockResolvedValue(curso());
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.rescheduleCourseAutomations.mockResolvedValue(RESCHEDULE_VACIO);
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
});

describe("markCourseAutomationReconcilePending", () => {
  it("marca el curso con fecha y motivo, con el cliente que se le pase (tx o prisma directo)", async () => {
    const tx = { course: { update: vi.fn() } };
    await markCourseAutomationReconcilePending(tx as any, "course-1", "SESSION_UPDATED");
    expect(tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "SESSION_UPDATED" },
    });
  });
});

describe("reconcileCourseDerivedState: paquete completo con éxito", () => {
  it("sincroniza Course.startsAt/endsAt con las sesiones reales cuando están desincronizados", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(curso({
      startsAt: new Date("2020-01-01T00:00:00Z"),
      endsAt: new Date("2020-01-01T02:00:00Z"),
      sessions: [{ id: "s1", title: null, startAt: new Date("2026-09-01T15:00:00Z"), endAt: new Date("2026-09-01T17:00:00Z"), streamUrl: null, timezone: "America/Guayaquil" }],
    }));
    const resultado = await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(resultado.ok).toBe(true);
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { startsAt: new Date("2026-09-01T15:00:00Z"), endsAt: new Date("2026-09-01T17:00:00Z") },
    });
  });

  it("si ya están sincronizados, no vuelve a escribir startsAt/endsAt", async () => {
    await reconcileCourseDerivedState("course-1", null, AHORA);
    const llamadasDeFechas = mocks.prisma.course.update.mock.calls.filter(([arg]) => "startsAt" in (arg.data ?? {}));
    expect(llamadasDeFechas).toHaveLength(0);
  });

  it("recalcula la cola de recordatorios de todas las inscripciones", async () => {
    await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", AHORA);
  });

  it("refresca nextExecutionAt de reglas fijas (BEFORE_COURSE/AFTER_COURSE) cuya ventana cambió", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([
      { id: "rule-1", trigger: "BEFORE_COURSE", offsetMinutes: 60, nextExecutionAt: new Date("2020-01-01T00:00:00Z") },
    ]);
    const resultado = await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(resultado.ok && resultado.rulesRefreshed).toBe(1);
    expect(mocks.prisma.automationRule.update).toHaveBeenCalledWith({
      where: { id: "rule-1" },
      data: { nextExecutionAt: new Date("2026-09-01T14:00:00Z") },
    });
  });

  it("no reescribe nextExecutionAt si ya coincide con lo calculado", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([
      { id: "rule-1", trigger: "BEFORE_COURSE", offsetMinutes: 60, nextExecutionAt: new Date("2026-09-01T14:00:00Z") },
    ]);
    const resultado = await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(resultado.ok && resultado.rulesRefreshed).toBe(0);
    expect(mocks.prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it("solo consulta reglas ACTIVE con trigger fijo, no ON_REGISTRATION ni pausadas/archivadas", async () => {
    await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(mocks.prisma.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { courseId: "course-1", status: "ACTIVE", trigger: { in: ["BEFORE_COURSE", "AFTER_COURSE"] } },
    }));
  });

  it("incluye la oferta institucional #12 en la MISMA reconciliación (sección 6)", async () => {
    await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(mocks.reprogramarOfertaAutomatica).toHaveBeenCalledWith("course-1", null);
  });

  it("limpia el flag pendiente solo cuando TODO el paquete terminó con éxito", async () => {
    await reconcileCourseDerivedState("course-1", null, AHORA);
    const limpieza = mocks.prisma.course.update.mock.calls.find(([arg]) => arg.data?.automationReconcilePendingAt === null);
    expect(limpieza).toBeDefined();
    expect(limpieza?.[0].data.automationReconcileReason).toBeNull();
  });
});

describe("reconcileCourseDerivedState: reintentos y fallo durable", () => {
  it("un primer intento fallido se reintenta una vez más (máximo 2 intentos inmediatos)", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(RESCHEDULE_VACIO);
    const resultado = await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(resultado.ok).toBe(true);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(2);
  });

  it("si fallan los dos intentos, el flag queda pendiente y nunca se propaga el error crudo", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto conexión perdida"));
    await expect(reconcileCourseDerivedState("course-1", null, AHORA)).resolves.toEqual({ ok: false, pending: true });
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(2);
    const limpieza = mocks.prisma.course.update.mock.calls.find(([arg]) => arg.data?.automationReconcilePendingAt === null);
    expect(limpieza).toBeUndefined();
  });

  it("un fallo durable se audita con un código clasificado, nunca el mensaje crudo del error", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto-de-produccion conexión perdida en la línea 42"));
    await reconcileCourseDerivedState("course-1", null, AHORA);
    const auditoria = mocks.writeAudit.mock.calls[0][0];
    expect(auditoria.action).toBe("COURSE_RECONCILE_FAILED");
    expect(auditoria.result).toBe("FAILURE");
    expect(auditoria.metadata).toEqual({ intentos: 2, errorCode: "RECONCILE_STEP_FAILED" });
    expect(JSON.stringify(auditoria.metadata)).not.toContain("secreto-de-produccion");
  });

  it("si el reschedule falla, la oferta #12 no se toca en ese mismo intento (sección E)", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("caído"));
    await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(mocks.reprogramarOfertaAutomatica).not.toHaveBeenCalled();
  });

  it("marca pendiente al empezar si nadie lo había marcado antes, sin pisar una razón ya existente", async () => {
    await reconcileCourseDerivedState("course-1", null, AHORA);
    expect(mocks.prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: "course-1", automationReconcilePendingAt: null },
      data: { automationReconcilePendingAt: AHORA, automationReconcileReason: "RECONCILE_STARTED" },
    });
  });
});

describe("recuperarReconciliacionesPendientes (barrido durable del cron, sección 2)", () => {
  it("busca cursos con automationReconcilePendingAt no nulo, los más viejos primero, tope 5", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([]);
    await recuperarReconciliacionesPendientes(AHORA);
    expect(mocks.prisma.course.findMany).toHaveBeenCalledWith({
      where: { automationReconcilePendingAt: { not: null } },
      select: { id: true },
      orderBy: { automationReconcilePendingAt: "asc" },
      take: 5,
    });
  });

  it("recupera un curso pendiente aunque no exista todavía ningún OutboundMessage (prueba A/sesión recién creada)", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([{ id: "course-nuevo" }]);
    const resultado = await recuperarReconciliacionesPendientes(AHORA);
    expect(resultado).toEqual({ cursos: 1, recuperados: 1 });
  });

  it("un curso que sigue fallando tras dos intentos no cuenta como recuperado, pero no detiene a los demás", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([{ id: "curso-a" }, { id: "curso-b" }]);
    mocks.rescheduleCourseAutomations
      .mockRejectedValueOnce(new Error("caído"))
      .mockRejectedValueOnce(new Error("caído"))
      .mockResolvedValueOnce(RESCHEDULE_VACIO);
    const resultado = await recuperarReconciliacionesPendientes(AHORA);
    expect(resultado).toEqual({ cursos: 2, recuperados: 1 });
  });
});
