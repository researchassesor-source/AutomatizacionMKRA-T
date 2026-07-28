import { NextResponse } from "next/server";
import { publishPost } from "@/lib/social/orchestrator";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Publica un post concreto de inmediato desde el panel.
export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  let postId: string | undefined;
  try {
    postId = (await request.json())?.postId;
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }
  if (!postId) {
    return NextResponse.json({ error: "falta postId" }, { status: 422 });
  }

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
