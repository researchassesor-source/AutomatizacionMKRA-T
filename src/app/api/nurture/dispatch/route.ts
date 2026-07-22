import { NextResponse } from "next/server";
import { processScheduledMessages } from "@/lib/nurture/engine";
import { checkCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/**
 * Dispatcher de la cola de nurture: envia los mensajes programados vencidos.
 * Llamar periodicamente desde un cron (cada 5-15 min).
 * GET  -> lo usa Vercel Cron (protegido con CRON_SECRET).
 * POST -> invocacion manual.
 */
async function run() {
  try {
    const summary = await processScheduledMessages();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[nurture/dispatch] error", err);
    return NextResponse.json({ error: "fallo del dispatcher" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!checkCronAuth(request)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  return run();
}

export async function POST() {
  return run();
}
