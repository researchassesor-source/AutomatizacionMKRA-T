// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    socialPost: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    socialSchedule: { findMany: vi.fn(), update: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { expandDueSchedules, fastForwardOccurrence, processScheduledPosts, publishPost } from "./orchestrator";
import { resolveSocialWindow } from "@/lib/live-activation";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function liveEnv(liveFrom?: string) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SOCIAL_MODE", "live");
  if (liveFrom !== undefined) vi.stubEnv("SOCIAL_LIVE_FROM", liveFrom);
}

beforeEach(() => {
  mocks.prisma.socialPost.findMany.mockResolvedValue([]);
  mocks.prisma.socialPost.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.socialSchedule.findMany.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("bloqueo de publicación sin fecha de activación", () => {
  it("no consulta ni publica nada si falta SOCIAL_LIVE_FROM", async () => {
    liveEnv();
    const summary = await processScheduledPosts(NOW);
    expect(summary).toMatchObject({ blocked: true, errorCode: "LIVE_FROM_MISSING", processed: 0, expanded: 0 });
    expect(mocks.prisma.socialPost.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.socialSchedule.findMany).not.toHaveBeenCalled();
  });

  it("no marca publicaciones interrumpidas cuando está bloqueado", async () => {
    liveEnv("no es una fecha");
    const summary = await processScheduledPosts(NOW);
    expect(summary.errorCode).toBe("LIVE_FROM_INVALID");
    expect(mocks.prisma.socialPost.updateMany).not.toHaveBeenCalled();
  });

  it("publishPost rechaza sin reclamar el registro", async () => {
    liveEnv();
    const result = await publishPost("post-1");
    expect(result).toMatchObject({ ok: false, errorCode: "LIVE_FROM_MISSING" });
    expect(mocks.prisma.socialPost.updateMany).not.toHaveBeenCalled();
  });

  it("en simulación publica en modo seguro sin exigir la fecha", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SOCIAL_MODE", "simulation");
    const summary = await processScheduledPosts(NOW);
    expect(summary.blocked).toBe(false);
    expect(mocks.prisma.socialPost.findMany).toHaveBeenCalled();
  });
});

describe("filtro por fecha de activación", () => {
  it("acota la consulta al intervalo permitido", async () => {
    liveEnv("2026-08-06T18:00:00Z");
    await processScheduledPosts(NOW);
    const where = mocks.prisma.socialPost.findMany.mock.calls[0][0].where;
    expect(where.scheduledAt).toEqual({ lte: NOW, gte: new Date("2026-08-06T18:00:00.000Z") });
  });

  it("rechaza una publicación anterior al corte sin cambiar su estado", async () => {
    liveEnv("2026-08-06T18:00:00Z");
    mocks.prisma.socialPost.findUnique.mockResolvedValue({ scheduledAt: new Date("2026-07-20T10:00:00.000Z"), status: "PROGRAMADO" });
    const result = await publishPost("post-viejo");
    expect(result).toMatchObject({ ok: false, errorCode: "BEFORE_LIVE_FROM" });
    expect(mocks.prisma.socialPost.updateMany).not.toHaveBeenCalled();
  });
});

describe("recurrencias anteriores al corte", () => {
  it("adelanta la recurrencia sin materializar publicaciones atrasadas", async () => {
    liveEnv("2026-08-06T18:00:00Z");
    mocks.prisma.socialSchedule.findMany.mockResolvedValue([{
      id: "schedule-1",
      accountId: "account-1",
      weekday: 1,
      localTime: "09:30",
      caption: "Contenido recurrente",
      mediaUrl: null,
      linkUrl: null,
      lastRunAt: null,
      nextRunAt: new Date("2026-06-01T14:30:00.000Z"),
    }]);
    const created = await expandDueSchedules(NOW, resolveSocialWindow());
    expect(created).toBe(0);
    expect(mocks.prisma.socialPost.create).not.toHaveBeenCalled();
    const update = mocks.prisma.socialSchedule.update.mock.calls[0][0];
    expect(update.data.nextRunAt.getTime()).toBeGreaterThanOrEqual(new Date("2026-08-06T18:00:00.000Z").getTime());
    // No inventa una ejecución que nunca ocurrió.
    expect(update.data.lastRunAt).toBeNull();
  });

  it("deja constancia del adelanto en la auditoría", async () => {
    liveEnv("2026-08-06T18:00:00Z");
    mocks.prisma.socialSchedule.findMany.mockResolvedValue([{
      id: "schedule-1", accountId: "account-1", weekday: 1, localTime: "09:30",
      caption: "c", mediaUrl: null, linkUrl: null, lastRunAt: null,
      nextRunAt: new Date("2026-06-01T14:30:00.000Z"),
    }]);
    await expandDueSchedules(NOW, resolveSocialWindow());
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "SOCIAL_SCHEDULES_FAST_FORWARDED" }));
  });

  it("materializa con normalidad una recurrencia posterior al corte", async () => {
    liveEnv("2026-06-01T00:00:00Z");
    mocks.prisma.socialSchedule.findMany.mockResolvedValue([{
      id: "schedule-1", accountId: "account-1", weekday: 1, localTime: "09:30",
      caption: "c", mediaUrl: null, linkUrl: null, lastRunAt: null,
      nextRunAt: new Date("2026-08-03T14:30:00.000Z"),
    }]);
    const created = await expandDueSchedules(NOW, resolveSocialWindow());
    expect(created).toBe(1);
    expect(mocks.prisma.socialPost.create).toHaveBeenCalled();
  });
});

describe("avance de ocurrencias", () => {
  it("salta hasta la primera ocurrencia dentro de la ventana", () => {
    const resumeAt = fastForwardOccurrence(1, "09:30", new Date("2026-06-01T14:30:00.000Z"), new Date("2026-08-06T18:00:00.000Z"));
    expect(resumeAt.getTime()).toBeGreaterThanOrEqual(new Date("2026-08-06T18:00:00.000Z").getTime());
    // Lunes 10 de agosto, 09:30 en Guayaquil = 14:30 UTC.
    expect(resumeAt.toISOString()).toBe("2026-08-10T14:30:00.000Z");
  });

  it("no itera indefinidamente ante un objetivo inalcanzable", () => {
    const resumeAt = fastForwardOccurrence(1, "09:30", new Date("2026-06-01T14:30:00.000Z"), new Date("2400-01-01T00:00:00.000Z"), 5);
    expect(resumeAt.toISOString()).toBe("2026-07-06T14:30:00.000Z");
  });

  it("no mueve una ocurrencia que ya está dentro de la ventana", () => {
    const from = new Date("2026-09-07T14:30:00.000Z");
    expect(fastForwardOccurrence(1, "09:30", from, new Date("2026-08-06T18:00:00.000Z"))).toBe(from);
  });
});
