import { prisma } from "@/lib/db";
import { MetaAdapter } from "./adapters/meta";
import type { Platform, SocialAdapter } from "./types";

/**
 * Registro de adaptadores disponibles, construidos a partir de variables de
 * entorno. Anadir una red nueva (TikTok, YouTube, LinkedIn) es solo crear su
 * adaptador y registrarlo aqui: el resto del sistema no cambia.
 */
function buildAdapters(): Partial<Record<Platform, SocialAdapter>> {
  const metaConfig = {
    accessToken: process.env.META_ACCESS_TOKEN,
    pageId: process.env.META_PAGE_ID,
    igUserId: process.env.META_IG_USER_ID,
  };

  return {
    INSTAGRAM: new MetaAdapter("INSTAGRAM", metaConfig),
    FACEBOOK: new MetaAdapter("FACEBOOK", metaConfig),
    // TIKTOK: new TikTokAdapter(...),
    // YOUTUBE: new YouTubeAdapter(...),
    // LINKEDIN: new LinkedInAdapter(...),
  };
}

const adapters = buildAdapters();

export function getAdapter(platform: Platform): SocialAdapter | undefined {
  return adapters[platform];
}

/**
 * Publica un SocialPost concreto (por id) usando el adaptador de su cuenta.
 * Actualiza el estado del post en la base de datos segun el resultado.
 */
export async function publishPost(postId: string) {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    include: { account: true },
  });
  if (!post) return { ok: false, error: "post no encontrado" };

  const adapter = getAdapter(post.account.platform);
  if (!adapter) {
    return { ok: false, error: `sin adaptador para ${post.account.platform}` };
  }

  await prisma.socialPost.update({
    where: { id: post.id },
    data: { status: "PUBLICANDO" },
  });

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
          externalPostId: result.externalPostId,
          error: null,
        }
      : { status: "FALLIDO", error: result.error },
  });

  return result;
}

/**
 * Procesa la cola: publica todos los posts PROGRAMADO cuya hora ya llego.
 * Pensado para ser llamado por un cron (ver README). Devuelve un resumen.
 */
export async function processScheduledPosts(now = new Date()) {
  const pending = await prisma.socialPost.findMany({
    where: { status: "PROGRAMADO", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 25,
  });

  const results = [];
  for (const post of pending) {
    results.push({ id: post.id, ...(await publishPost(post.id)) });
  }
  return { processed: results.length, results };
}
