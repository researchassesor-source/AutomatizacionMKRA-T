import { NextResponse } from "next/server";
import { processScheduledMessages } from "@/lib/nurture/engine";

export const dynamic = "force-dynamic";

// Procesa la cola de nurture desde el panel (envio manual de lo vencido).
export async function POST() {
  const summary = await processScheduledMessages();
  return NextResponse.json(summary);
}
