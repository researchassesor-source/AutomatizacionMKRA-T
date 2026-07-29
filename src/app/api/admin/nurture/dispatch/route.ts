import { NextResponse } from "next/server";
import { z } from "zod";
import { processScheduledMessages } from "@/lib/nurture/engine";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { isMessagingSimulation } from "@/lib/nurture/engine";

export const dynamic = "force-dynamic";

// Procesa la cola de nurture desde el panel (envio manual de lo vencido).
export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING", "VENTAS"]);
  if (auth.error) return auth.error;
  const parsed = z.object({ confirm: z.literal(true) }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Debes confirmar explícitamente el procesamiento de la cola." },
      { status: 422 },
    );
  }
  const summary = await processScheduledMessages();
  await writeAudit({
    session: auth.session,
    action: "MESSAGE_DISPATCH_REQUESTED",
    entityType: "OutboundMessage",
    metadata: {
      processed: summary.processed,
      simulation: isMessagingSimulation(),
      result: summary.processed > 0 ? "PROCESSED" : "NO_PENDING_MESSAGES",
    },
  });
  return NextResponse.json(summary);
}
