import { NextResponse } from "next/server";
import { z } from "zod";
import { publishPost } from "@/lib/social/orchestrator";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Publica un post concreto de inmediato desde el panel.
export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = z.object({ postId: z.string().trim().min(1).max(100), confirm: z.literal(true) }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Debes confirmar explícitamente la publicación." }, { status: 422 });
  }
  const { postId } = parsed.data;

  const result = await publishPost(postId);
  await writeAudit({
    session: auth.session,
    action: "SOCIAL_POST_PUBLISH_REQUESTED",
    entityType: "SocialPost",
    entityId: postId,
    result: result.ok ? "SUCCESS" : "FAILURE",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
