import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { sendMessage } from "@/lib/nurture/engine";
import { writeAudit } from "@/lib/audit";

const schema = z.object({ action: z.enum(["cancel", "retry"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING", "VENTAS"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Acción no válida." }, { status: 422 });
  const { id } = await params;
  const message = await prisma.outboundMessage.findUnique({ where: { id } });
  if (!message) return NextResponse.json({ error: "No se encontró el mensaje." }, { status: 404 });

  if (parsed.data.action === "cancel") {
    if (!["PROGRAMADO", "FALLIDO"].includes(message.status)) {
      return NextResponse.json({ error: "El mensaje ya no puede cancelarse." }, { status: 409 });
    }
    await prisma.outboundMessage.update({
      where: { id },
      data: { status: "CANCELADO", cancelledAt: new Date() },
    });
    await writeAudit({ session: auth.session, action: "MESSAGE_CANCELLED", entityType: "OutboundMessage", entityId: id });
    return NextResponse.json({ ok: true });
  }

  if (!["FALLIDO", "SIMULADO"].includes(message.status)) {
    return NextResponse.json({ error: "Solo se pueden reintentar mensajes fallidos o simulados." }, { status: 409 });
  }
  await prisma.outboundMessage.update({
    where: { id },
    data: { status: "FALLIDO", cancelledAt: null, error: null },
  });
  const result = await sendMessage(id);
  await writeAudit({
    session: auth.session,
    action: "MESSAGE_RETRIED",
    entityType: "OutboundMessage",
    entityId: id,
    result: result.ok ? "SUCCESS" : "FAILURE",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
