import { NextResponse } from "next/server";
import { processScheduledPosts, publishPost } from "@/lib/social/orchestrator";
import { checkCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// La firma de QStash se calcula sobre el cuerpo crudo, y eso exige node:crypto.
export const runtime = "nodejs";

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
  } catch {
    console.error("[social/publish] cron error");
    return NextResponse.json({ error: "fallo del orquestador" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // El cuerpo se lee UNA vez y en crudo: la firma de QStash se calcula sobre
  // el texto exacto que llego, y reserializar el JSON la invalidaria.
  const rawBody = await request.text();
  if (!checkCronAuth(request, rawBody)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  let postId: string | undefined;
  try {
    postId = rawBody ? JSON.parse(rawBody)?.postId : undefined;
  } catch {
    // sin body o cuerpo no interpretable: modo cola
  }

  try {
    if (postId) {
      const result = await publishPost(postId);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }
    const summary = await processScheduledPosts();
    return NextResponse.json(summary);
  } catch {
    console.error("[social/publish] error");
    return NextResponse.json({ error: "fallo del orquestador" }, { status: 500 });
  }
}
