// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    outboundMessage: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    enrollment: { findMany: vi.fn(), findUnique: vi.fn() },
    courseSession: { findMany: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
  send: vi.fn(async () => ({ ok: true, providerName: "smtp", providerMessageId: "id-de-prueba" })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("./channels/email", () => ({ EmailChannel: class { send = mocks.send } }));

import { processScheduledMessages, rescheduleCourseAutomations, sendMessage } from "./engine";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function liveEnv(liveFrom?: string) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("MESSAGING_MODE", "live");
  if (liveFrom !== undefined) vi.stubEnv("MESSAGING_LIVE_FROM", liveFrom);
}

beforeEach(() => {
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.outboundMessage.findMany.mockResolvedValue([]);
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.courseSession.findMany.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("bloqueo del procesador sin fecha de activación", () => {
  it("no selecciona ni envía nada si falta MESSAGING_LIVE_FROM", async () => {
    liveEnv();
    const summary = await processScheduledMessages(NOW);
    expect(summary).toMatchObject({ blocked: true, errorCode: "LIVE_FROM_MISSING", processed: 0 });
    expect(mocks.prisma.outboundMessage.findMany).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("no selecciona ni envía nada si la fecha es inválida", async () => {
    liveEnv("mañana temprano");
    const summary = await processScheduledMessages(NOW);
    expect(summary).toMatchObject({ blocked: true, errorCode: "LIVE_FROM_INVALID" });
    expect(mocks.prisma.outboundMessage.findMany).not.toHaveBeenCalled();
  });

  it("deja constancia del bloqueo en la auditoría", async () => {
    liveEnv();
    await processScheduledMessages(NOW);
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MESSAGE_DISPATCH_BLOCKED", result: "FAILURE" }));
  });

  it("sendMessage rechaza sin tocar el estado del mensaje", async () => {
    liveEnv();
    const result = await sendMessage("mensaje-1");
    expect(result).toMatchObject({ ok: false, errorCode: "LIVE_FROM_MISSING" });
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  it("en simulación funciona sin exigir la fecha", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("MESSAGING_MODE", "simulation");
    const summary = await processScheduledMessages(NOW);
    expect(summary.blocked).toBe(false);
    expect(mocks.prisma.outboundMessage.findMany).toHaveBeenCalled();
  });
});

describe("filtro por fecha de activación", () => {
  it("añade el corte a la consulta de pendientes", async () => {
    liveEnv("2026-08-06T18:00:00Z");
    await processScheduledMessages(NOW);
    const where = mocks.prisma.outboundMessage.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ scheduledAt: { gte: new Date("2026-08-06T18:00:00.000Z") } });
  });

  it("rechaza un mensaje antiguo sin cambiar su estado", async () => {
    liveEnv("2026-08-06T18:00:00Z");
    mocks.prisma.outboundMessage.findUnique.mockResolvedValue({ scheduledAt: new Date("2026-07-01T10:00:00.000Z") });
    const result = await sendMessage("mensaje-viejo");
    expect(result).toMatchObject({
      ok: false,
      errorCode: "BEFORE_LIVE_FROM",
      error: expect.stringContaining("no saldrá de forma automática"),
    });
    // Sigue visible como PROGRAMADO para poder cancelarlo o reprogramarlo.
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  it("deja pasar un mensaje posterior al corte", async () => {
    liveEnv("2026-08-06T18:00:00Z");
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: new Date("2026-08-10T09:00:00.000Z") })
      .mockResolvedValueOnce({
        id: "mensaje-nuevo", channel: "EMAIL", toAddress: "persona@example.test", subject: "Hola", body: "Cuerpo",
        attemptCount: 0, automationRuleId: null,
        lead: { classification: "REAL", consent: true },
      });
    const result = await sendMessage("mensaje-nuevo");
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

describe("reprogramación por lotes sin tope silencioso", () => {
  function enrollmentPages(total: number) {
    const ids = Array.from({ length: total }, (_, index) => ({ id: `enrollment-${String(index).padStart(5, "0")}` }));
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ take, cursor, skip }: any) => {
      const start = cursor ? ids.findIndex((item) => item.id === cursor.id) + (skip ?? 0) : 0;
      return ids.slice(start, start + take);
    });
    return ids;
  }

  beforeEach(() => {
    mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
    // Cada inscripción se resuelve como no elegible: basta para contar recorrido.
    mocks.prisma.enrollment.findUnique.mockResolvedValue(null);
  });

  it("procesa más de 300 inscripciones en varios lotes", async () => {
    enrollmentPages(437);
    const result = await rescheduleCourseAutomations("course-1", NOW);
    expect(result.enrollments).toBe(437);
    expect(result.batches).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it("no carga todas las inscripciones de una sola vez", async () => {
    enrollmentPages(437);
    await rescheduleCourseAutomations("course-1", NOW);
    for (const call of mocks.prisma.enrollment.findMany.mock.calls) {
      expect(call[0].take).toBeLessThanOrEqual(100);
    }
  });

  it("pagina con cursor estable sobre id", async () => {
    enrollmentPages(250);
    await rescheduleCourseAutomations("course-1", NOW);
    const calls = mocks.prisma.enrollment.findMany.mock.calls;
    expect(calls[0][0].orderBy).toEqual({ id: "asc" });
    expect(calls[0][0].cursor).toBeUndefined();
    expect(calls[1][0]).toMatchObject({ cursor: { id: "enrollment-00099" }, skip: 1 });
  });

  it("es idempotente: dos pasadas recorren lo mismo", async () => {
    enrollmentPages(320);
    const first = await rescheduleCourseAutomations("course-1", NOW);
    const second = await rescheduleCourseAutomations("course-1", NOW);
    expect(second.enrollments).toBe(first.enrollments);
  });

  it("informa cuántas procesó", async () => {
    enrollmentPages(305);
    const result = await rescheduleCourseAutomations("course-1", NOW);
    expect(result.enrollments).toBe(305);
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AUTOMATION_COURSE_RESCHEDULED", metadata: expect.objectContaining({ enrollments: 305 }) }),
    );
  });
});
