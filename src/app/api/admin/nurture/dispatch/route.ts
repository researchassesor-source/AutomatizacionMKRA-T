import { NextResponse } from "next/server";
import { processScheduledMessages } from "@/lib/nurture/engine";
import { requireRole } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

// Procesa la cola de nurture desde el panel (envio manual de lo vencido).
export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING", "VENTAS"]);
  if (auth.error) return auth.error;
  const summary = await processScheduledMessages();
  return NextResponse.json(summary);
}
