import { NextResponse } from "next/server";
import { processScheduledPosts, publishPost } from "@/lib/social/orchestrator";
import { checkCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Endpoint del orquestador de publicaciones.
 *
 *  - GET  -> procesa la cola de posts PROGRAMADO vencidos (Vercel Cron,
 *    protegido con CRON_SECRET).
 *  - POST sin body / sin postId -> procesa la cola (invocacion manual).
 *  - POST con { postId }        -> publica ese post inmediatamente.
 */
export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  try {
    const summary = await processScheduledPosts();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[social/publish] cron error", err);
    return NextResponse.json({ error: "fallo del orquestador" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let postId: string | undefined;
  try {
    const body = await request.json();
    postId = body?.postId;
  } catch {
    // sin body: modo cola
  }

  try {
    if (postId) {
      const result = await publishPost(postId);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }
    const summary = await processScheduledPosts();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[social/publish] error", err);
    return NextResponse.json({ error: "fallo del orquestador" }, { status: 500 });
  }
}
