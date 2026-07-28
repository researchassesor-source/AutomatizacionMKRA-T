import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { publishPost } from "@/lib/social/orchestrator";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  action: z.enum(["update", "reschedule", "cancel", "duplicate", "retry"]),
  caption: z.string().trim().min(1).max(10000).optional(),
  mediaUrl: z.string().url().nullable().optional(),
  linkUrl: z.string().url().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "No se encontró la publicación." }, { status: 404 });

  if (parsed.data.action === "cancel") {
    if (!["BORRADOR", "PROGRAMADO", "FALLIDO", "SIMULADO"].includes(post.status)) {
      return NextResponse.json({ error: "La publicación ya no puede cancelarse." }, { status: 409 });
    }
    await prisma.socialPost.update({ where: { id }, data: { status: "CANCELADO", cancelledAt: new Date() } });
  } else if (parsed.data.action === "duplicate") {
    const duplicate = await prisma.socialPost.create({
      data: {
        accountId: post.accountId,
        caption: post.caption,
        mediaUrl: post.mediaUrl,
        linkUrl: post.linkUrl,
        status: "BORRADOR",
        duplicatedFromId: post.id,
      },
    });
    await writeAudit({ session: auth.session, action: "SOCIAL_POST_DUPLICATED", entityType: "SocialPost", entityId: duplicate.id });
    return NextResponse.json({ ok: true, postId: duplicate.id });
  } else if (parsed.data.action === "retry") {
    if (!["FALLIDO", "SIMULADO"].includes(post.status)) {
      return NextResponse.json({ error: "La publicación no admite reintento." }, { status: 409 });
    }
    const result = await publishPost(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } else {
    if (!["BORRADOR", "PROGRAMADO", "FALLIDO", "SIMULADO"].includes(post.status)) {
      return NextResponse.json({ error: "La publicación ya no puede editarse." }, { status: 409 });
    }
    const scheduledAt = parsed.data.scheduledAt === null
      ? null
      : parsed.data.scheduledAt
        ? new Date(parsed.data.scheduledAt)
        : post.scheduledAt;
    await prisma.socialPost.update({
      where: { id },
      data: {
        caption: parsed.data.caption,
        mediaUrl: parsed.data.mediaUrl,
        linkUrl: parsed.data.linkUrl,
        scheduledAt,
        cancelledAt: null,
        error: null,
        status: scheduledAt ? "PROGRAMADO" : "BORRADOR",
      },
    });
  }
  await writeAudit({
    session: auth.session,
    action: `SOCIAL_POST_${parsed.data.action.toUpperCase()}`,
    entityType: "SocialPost",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
