import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { MetaAdapter } from "./adapters/meta";
import { TikTokAdapter } from "./adapters/tiktok";
import type { Platform, SocialAdapter } from "./types";
import { mustSimulateExternalIntegration } from "@/lib/runtime-environment";

function buildAdapters(): Partial<Record<Platform, SocialAdapter>> {
  const metaConfig = {
    accessToken: process.env.META_ACCESS_TOKEN,
    pageId: process.env.META_PAGE_ID,
    igUserId: process.env.META_IG_USER_ID,
  };
  return {
    INSTAGRAM: new MetaAdapter("INSTAGRAM", metaConfig),
    FACEBOOK: new MetaAdapter("FACEBOOK", metaConfig),
    TIKTOK: new TikTokAdapter({
      clientKey: process.env.TIKTOK_CLIENT_KEY,
      clientSecret: process.env.TIKTOK_CLIENT_SECRET,
      refreshToken: process.env.TIKTOK_REFRESH_TOKEN,
      privacy: process.env.TIKTOK_PRIVACY,
    }),
  };
}

const adapters = buildAdapters();

export function getAdapter(platform: Platform): SocialAdapter | undefined {
  return adapters[platform];
}

export type SocialConnectionState = "SIMULATION" | "READY" | "NOT_CONFIGURED" | "UNSUPPORTED";

export function isSocialSimulation(): boolean {
  return mustSimulateExternalIntegration(process.env.SOCIAL_MODE);
}

export function socialConnectionState(platform: Platform): SocialConnectionState {
  const adapter = getAdapter(platform);
  if (!adapter) return "UNSUPPORTED";
  if (isSocialSimulation()) return "SIMULATION";
  return adapter.isConfigured() ? "READY" : "NOT_CONFIGURED";
}

export function isSocialAccountUsable(platform: Platform): boolean {
  return ["SIMULATION", "READY"].includes(socialConnectionState(platform));
}

export async function verifyPlatformConnection(platform: Platform) {
  if (isSocialSimulation()) {
    return { ok: false, error: "La conexión real está desactivada en este entorno." };
  }
  const adapter = adapters[platform];
  if (adapter instanceof MetaAdapter || adapter instanceof TikTokAdapter) return adapter.verifyConnection();
  return { ok: false, error: `La conexión aún no está disponible para ${platform}.` };
}

export function nextGuayaquilOccurrence(weekday: number, localTime: string, after = new Date()) {
  const [hour, minute] = localTime.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error("Hora no válida.");
  const localNow = new Date(after.getTime() - 5 * 60 * 60 * 1000);
  let days = (weekday - localNow.getUTCDay() + 7) % 7;
  let candidate = new Date(
    Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate() + days,
      hour + 5,
      minute,
    ),
  );
  if (candidate <= after) {
    days += 7;
    candidate = new Date(
      Date.UTC(
        localNow.getUTCFullYear(),
        localNow.getUTCMonth(),
        localNow.getUTCDate() + days,
        hour + 5,
        minute,
      ),
    );
  }
  return candidate;
}

export async function expandDueSchedules(now = new Date()) {
  const schedules = await prisma.socialSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now }, account: { isActive: true } },
    take: 50,
  });
  let created = 0;
  for (const schedule of schedules) {
    const occurrenceKey = `${schedule.id}:${schedule.nextRunAt.toISOString()}`;
    try {
      await prisma.socialPost.create({
        data: {
          accountId: schedule.accountId,
          scheduleId: schedule.id,
          occurrenceKey,
          caption: schedule.caption,
          mediaUrl: schedule.mediaUrl,
          linkUrl: schedule.linkUrl,
          status: "PROGRAMADO",
          scheduledAt: schedule.nextRunAt,
        },
      });
      created++;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
    }
    await prisma.socialSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: schedule.nextRunAt,
        nextRunAt: nextGuayaquilOccurrence(schedule.weekday, schedule.localTime, schedule.nextRunAt),
      },
    });
  }
  return created;
}

export async function publishPost(postId: string) {
  const claimed = await prisma.socialPost.updateMany({
    where: {
      id: postId,
      status: { in: ["BORRADOR", "PROGRAMADO", "FALLIDO", "SIMULADO"] },
      account: { isActive: true },
    },
    data: { status: "PUBLICANDO", publishStartedAt: new Date(), error: null },
  });
  if (claimed.count !== 1) return { ok: false, error: "La publicación ya está siendo procesada o fue cancelada." };

  const post = await prisma.socialPost.findUnique({ where: { id: postId }, include: { account: true } });
  if (!post) return { ok: false, error: "No se encontró la publicación." };

  if (isSocialSimulation()) {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "SIMULADO", publishStartedAt: null, error: null },
    });
    return { ok: true, simulated: true };
  }

  const adapter = getAdapter(post.account.platform);
  if (!adapter) {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "FALLIDO", error: "Esta red todavía no tiene un conector habilitado." },
    });
    return { ok: false, error: "Esta red todavía no tiene un conector habilitado." };
  }

  const result = await adapter.publish({
    caption: post.caption,
    mediaUrl: post.mediaUrl ?? undefined,
    linkUrl: post.linkUrl ?? undefined,
  });
  await prisma.socialPost.update({
    where: { id: post.id },
    data: result.ok
      ? {
          status: "PUBLICADO",
          publishedAt: new Date(),
          publishStartedAt: null,
          externalPostId: result.externalPostId,
          error: null,
        }
      : {
          status: "FALLIDO",
          publishStartedAt: null,
          retryCount: { increment: 1 },
          error: result.error?.slice(0, 500) ?? "No se pudo publicar.",
        },
  });
  return result;
}

export async function processScheduledPosts(now = new Date()) {
  await prisma.socialPost.updateMany({
    where: { status: "PUBLICANDO", publishStartedAt: { lt: new Date(now.getTime() - 15 * 60 * 1000) } },
    data: { status: "FALLIDO", publishStartedAt: null, error: "La publicación quedó interrumpida y puede reintentarse." },
  });
  const expanded = await expandDueSchedules(now);
  const pending = await prisma.socialPost.findMany({
    where: { status: "PROGRAMADO", scheduledAt: { lte: now }, account: { isActive: true } },
    orderBy: { scheduledAt: "asc" },
    take: 25,
    select: { id: true },
  });
  const results = [];
  for (const post of pending) results.push({ id: post.id, ...(await publishPost(post.id)) });
  return { expanded, processed: results.length, results };
}
