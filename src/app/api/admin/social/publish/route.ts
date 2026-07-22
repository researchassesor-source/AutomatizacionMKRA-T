import { NextResponse } from "next/server";
import { publishPost } from "@/lib/social/orchestrator";

export const dynamic = "force-dynamic";

// Publica un post concreto de inmediato desde el panel.
export async function POST(request: Request) {
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
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
