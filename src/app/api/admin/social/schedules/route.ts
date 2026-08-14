import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { isSocialAccountUsable, nextGuayaquilOccurrence } from "@/lib/social/orchestrator";
import { writeAudit } from "@/lib/audit";
import { CONTENIDO } from "@/lib/auth/roles";
import { inferSocialMediaType, isPublicSocialMediaUrl } from "@/lib/social/media";
import { scopesFromJson } from "@/lib/social/tiktok-business/account";
import { hasRequiredTikTokBusinessScopes, isApprovedTikTokBusinessMediaUrl, resolveTikTokBusinessConfig } from "@/lib/social/tiktok-business/config";

const schema = z.object({
  accountId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  caption: z.string().trim().min(1).max(10000),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  linkUrl: z.string().url().optional().or(z.literal("")),
  weekday: z.number().int().min(0).max(6),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Recurrencia no válida." }, { status: 422 });
  const account = await prisma.socialAccount.findUnique({ where: { id: parsed.data.accountId } });
  if (!account?.isActive || !isSocialAccountUsable(account.platform)) {
    return NextResponse.json({ error: "La cuenta no está disponible para programar en este entorno." }, { status: 422 });
  }
  if (parsed.data.mediaUrl && !isPublicSocialMediaUrl(parsed.data.mediaUrl)) {
    return NextResponse.json({ error: "El archivo debe estar disponible mediante una URL pública HTTPS." }, { status: 422 });
  }
  if (account.platform === "TIKTOK") {
    const config = resolveTikTokBusinessConfig();
    if (config.reason) return NextResponse.json({ error: config.reason }, { status: 422 });
    const connection = await prisma.tikTokBusinessConnection.findUnique({ where: { socialAccountId: account.id } });
    if (connection?.status !== "READY" || !connection.accessTokenCipher || !hasRequiredTikTokBusinessScopes(scopesFromJson(connection.grantedScopes))) {
      return NextResponse.json({ error: "La cuenta TikTok Business no está conectada o no tiene todos los permisos." }, { status: 422 });
    }
    const mediaUrl = parsed.data.mediaUrl;
    if (!mediaUrl || inferSocialMediaType(mediaUrl) !== "VIDEO" || !isApprovedTikTokBusinessMediaUrl(mediaUrl)) {
      return NextResponse.json({ error: "TikTok Business solo admite videos subidos al almacenamiento público autorizado del CRM." }, { status: 422 });
    }
  }
  const schedule = await prisma.socialSchedule.create({
    data: {
      ...parsed.data,
      mediaUrl: parsed.data.mediaUrl || null,
      linkUrl: parsed.data.linkUrl || null,
      timezone: "America/Guayaquil",
      nextRunAt: nextGuayaquilOccurrence(parsed.data.weekday, parsed.data.localTime),
    },
  }).catch(() => null);
  if (!schedule) return NextResponse.json({ error: "No se pudo crear la recurrencia." }, { status: 400 });
  await writeAudit({ session: auth.session, action: "SOCIAL_SCHEDULE_CREATED", entityType: "SocialSchedule", entityId: schedule.id });
  return NextResponse.json({ ok: true, schedule }, { status: 201 });
}
