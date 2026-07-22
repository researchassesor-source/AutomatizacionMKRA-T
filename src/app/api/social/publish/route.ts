import { NextResponse } from "next/server";
import { processScheduledPosts, publishPost } from "@/lib/social/orchestrator";

export const dynamic = "force-dynamic";

/**
 * Endpoint del orquestador de publicaciones.
 *
 *  - Sin body / sin postId  -> procesa la cola de posts PROGRAMADO vencidos.
 *    Pensado para llamarse desde un cron (ver README).
 *  - Con { postId }          -> publica ese post inmediatamente.
 *
 * En produccion protege esta ruta con un token (cabecera Authorization).
 */
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
