import { NextResponse } from "next/server";
import { processScheduledMessages } from "@/lib/nurture/engine";

export const dynamic = "force-dynamic";

/**
 * Dispatcher de la cola de nurture: envia los mensajes programados vencidos.
 * Llamar periodicamente desde un cron (cada 5-15 min).
 * En produccion protege esta ruta con un token de autorizacion.
 */
export async function POST() {
  try {
    const summary = await processScheduledMessages();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[nurture/dispatch] error", err);
    return NextResponse.json({ error: "fallo del dispatcher" }, { status: 500 });
  }
}
