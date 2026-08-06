import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { PostStatus } from "@prisma/client";
import { MetaAdapter } from "./adapters/meta";
import { TikTokAdapter } from "./adapters/tiktok";
import { resolveMetaConfig } from "./meta-config";
import type { Platform, SocialAdapter } from "./types";
import {
  isWithinLiveWindow,
  outsideLiveWindowMessage,
  resolveSocialWindow,
  SOCIAL_LIVE_FROM,
  type LiveWindow,
} from "@/lib/live-activation";
import { mustSimulateExternalIntegration } from "@/lib/runtime-environment";
import { writeAudit } from "@/lib/audit";

/**
 * Los adaptadores se construyen en cada uso para leer la configuracion vigente
 * (y no la que existiera al importar el modulo).
 */
function buildAdapters(): Partial<Record<Platform, SocialAdapter>> {
  const metaConfig = resolveMetaConfig();
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

export function getAdapter(platform: Platform): SocialAdapter | undefined {
  return buildAdapters()[platform];
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

export function canDeleteLocalSocialPost(status: PostStatus, externalPostId?: string | null) {
  return !externalPostId && ["BORRADOR", "SIMULADO", "FALLIDO", "CANCELADO", "ARCHIVADO"].includes(status);
}

export async function verifyPlatformConnection(platform: Platform) {
  if (isSocialSimulation()) {
    return { ok: true, simulated: true, state: "SIMULATION" as const, message: "Preview no consulta proveedores reales." };
  }
  const adapter = getAdapter(platform);
  if (adapter instanceof MetaAdapter || adapter instanceof TikTokAdapter) return adapter.verifyConnection();
  return { ok: false, error: `La conexión aún no está disponible para ${platform}.` };
}

export function socialConnectionErrorState(error: string | undefined) {
  const normalized = error?.toLowerCase() ?? "";
  if (/expir|caduc/.test(normalized)) return "EXPIRED" as const;
  if (/permission|permiso|scope|acceso/.test(normalized)) return "MISSING_PERMISSION" as const;
  if (/disconnect|desconect|deactiv|revoc/.test(normalized)) return "DISCONNECTED" as const;
  return "ERROR" as const;
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

/**
 * Adelanta una recurrencia hasta su primera ocurrencia dentro de la ventana de
 * activación, sin materializar las publicaciones atrasadas por el camino.
 * El límite de iteraciones cubre con holgura cualquier fecha de corte razonable
 * (520 semanas = 10 años) y evita un bucle infinito ante datos corruptos.
 */
export function fastForwardOccurrence(
  weekday: number,
  localTime: string,
  from: Date,
  target: Date,
  maxIterations = 520,
): Date {
  let candidate = from;
  for (let index = 0; index < maxIterations && candidate.getTime() < target.getTime(); index++) {
    candidate = nextGuayaquilOccurrence(weekday, localTime, candidate);
  }
  return candidate;
}

export async function expandDueSchedules(now = new Date(), window: LiveWindow = resolveSocialWindow()) {
  if (window.state === "blocked") return 0;
  const schedules = await prisma.socialSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now }, account: { isActive: true } },
    take: 50,
  });
  let created = 0;
  let skipped = 0;
  for (const schedule of schedules) {
    // Una recurrencia vencida antes de la fecha de activación no genera
    // publicaciones atrasadas: se adelanta hasta la primera ocurrencia válida.
    if (window.state === "live" && schedule.nextRunAt.getTime() < window.liveFrom.getTime()) {
      const resumeAt = fastForwardOccurrence(schedule.weekday, schedule.localTime, schedule.nextRunAt, window.liveFrom);
      await prisma.socialSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: schedule.lastRunAt, nextRunAt: resumeAt },
      });
      skipped++;
      continue;
    }
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
  if (skipped > 0) {
    await writeAudit({
      actorEmail: "automation",
      action: "SOCIAL_SCHEDULES_FAST_FORWARDED",
      entityType: "SocialSchedule",
      metadata: { skipped, liveFrom: window.state === "live" ? window.liveFrom.toISOString() : null },
    });
  }
  return created;
}

export async function publishPost(postId: string) {
  // La ventana se comprueba antes de reclamar: una publicación bloqueada
  // conserva su estado y sigue visible y cancelable desde el panel.
  const window = resolveSocialWindow();
  if (window.state === "blocked") {
    return { ok: false, errorCode: window.errorCode, error: window.error };
  }
  const scheduled = await prisma.socialPost.findUnique({ where: { id: postId }, select: { scheduledAt: true, status: true } });
  if (!scheduled) return { ok: false, error: "No se encontró la publicación." };
  // Un borrador sin fecha se publica a mano desde el panel: la fecha de corte
  // protege de la cola atrasada, no de una acción deliberada de hoy.
  const effectiveSchedule = scheduled.scheduledAt ?? new Date();
  if (!isWithinLiveWindow(window, effectiveSchedule)) {
    return { ok: false, errorCode: "BEFORE_LIVE_FROM", error: outsideLiveWindowMessage(window, SOCIAL_LIVE_FROM) };
  }

  const claimed = await prisma.socialPost.updateMany({
    where: {
      id: postId,
      status: { in: ["BORRADOR", "PROGRAMADO", "FALLIDO", "SIMULADO"] },
      // Un registro que ya tiene identificador del proveedor no vuelve a
      // publicarse nunca: es la garantia de que un cron repetido no duplica
      // contenido en Facebook o Instagram.
      externalPostId: null,
      account: { isActive: true },
    },
    data: { status: "PUBLICANDO", publishStartedAt: new Date(), error: null },
  });
  if (claimed.count !== 1) {
    return { ok: false, error: "La publicación ya se envió al proveedor, está siendo procesada o fue cancelada." };
  }

  const post = await prisma.socialPost.findUnique({ where: { id: postId }, include: { account: true } });
  if (!post) return { ok: false, error: "No se encontró la publicación." };

  if (isSocialSimulation()) {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "SIMULADO", publishStartedAt: null, error: null, errorCode: null, errorMessage: null, providerResponse: { mode: "simulation", externalRequestPerformed: false } },
    });
    return { ok: true, simulated: true };
  }

  const adapter = getAdapter(post.account.platform);
  if (!adapter) {
    const error = "Esta red todavía no tiene un conector habilitado.";
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "FALLIDO", publishStartedAt: null, error, errorCode: "CONNECTOR_UNAVAILABLE", errorMessage: error },
    });
    return { ok: false, errorCode: "CONNECTOR_UNAVAILABLE", error };
  }

  const rawResult = await adapter.publish({
    caption: post.caption,
    mediaUrl: post.mediaUrl ?? undefined,
    linkUrl: post.linkUrl ?? undefined,
  });
  // Un "ok" sin identificador del proveedor no es una publicación verificable.
  // Marcarla como publicada dejaría un registro que afirma algo que no podemos
  // demostrar, así que se trata como fallo reintentable.
  const result = rawResult.ok && !rawResult.externalPostId
    ? {
        ...rawResult,
        ok: false,
        errorCode: "MISSING_PROVIDER_ID",
        error: "El proveedor aceptó la solicitud sin devolver un identificador; no se puede confirmar la publicación.",
      }
    : rawResult;
  await prisma.socialPost.update({
    where: { id: post.id },
    data: result.ok
      ? {
          status: result.accepted ? "ACEPTADO" : "PUBLICADO",
          publishedAt: result.accepted ? null : new Date(),
          publishStartedAt: null,
          externalPostId: result.externalPostId,
          providerPostUrl: result.providerPostUrl,
          providerResponse: result.providerResponse as Prisma.InputJsonValue | undefined,
          error: null,
          errorCode: null,
          errorMessage: null,
        }
      : {
          status: "FALLIDO",
          publishStartedAt: null,
          retryCount: { increment: 1 },
          error: result.error?.slice(0, 500) ?? "No se pudo publicar.",
          errorCode: result.errorCode?.slice(0, 120) ?? "PROVIDER_ERROR",
          errorMessage: result.error?.slice(0, 500) ?? "No se pudo publicar.",
          providerResponse: result.providerResponse as Prisma.InputJsonValue | undefined,
        },
  });
  return result;
}

export async function processScheduledPosts(now = new Date()) {
  // Un canal en live sin fecha de activación no publica nada: falla de forma
  // segura y lo dice, en lugar de vaciar la cola atrasada sobre las redes.
  const window = resolveSocialWindow();
  if (window.state === "blocked") {
    await writeAudit({
      actorEmail: "automation",
      action: "SOCIAL_PUBLISH_BLOCKED",
      entityType: "SocialPost",
      result: "FAILURE",
      metadata: { errorCode: window.errorCode, variable: SOCIAL_LIVE_FROM },
    });
    return { blocked: true, errorCode: window.errorCode, error: window.error, expanded: 0, processed: 0, results: [] };
  }
  await prisma.socialPost.updateMany({
    where: { status: "PUBLICANDO", publishStartedAt: { lt: new Date(now.getTime() - 15 * 60 * 1000) } },
    data: { status: "FALLIDO", publishStartedAt: null, error: "La publicación quedó interrumpida y puede reintentarse." },
  });
  const expanded = await expandDueSchedules(now, window);
  const pending = await prisma.socialPost.findMany({
    where: {
      status: "PROGRAMADO",
      scheduledAt: window.state === "live" ? { lte: now, gte: window.liveFrom } : { lte: now },
      account: { isActive: true },
    },
    orderBy: { scheduledAt: "asc" },
    take: 25,
    select: { id: true },
  });
  const results = [];
  for (const post of pending) results.push({ id: post.id, ...(await publishPost(post.id)) });
  return { blocked: false, errorCode: null, error: null, expanded, processed: results.length, results };
}
