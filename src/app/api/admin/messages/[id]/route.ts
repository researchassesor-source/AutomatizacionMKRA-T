import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { MAX_ATTEMPTS, sendMessage } from "@/lib/nurture/engine";
import { writeAudit } from "@/lib/audit";
import { OPERACION } from "@/lib/auth/roles";

const schema = z.object({ action: z.enum(["cancel", "retry"]), confirm: z.literal(true) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, OPERACION);
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
  // El presupuesto de intentos gobierna la cola automatica: hace que un fallo
  // temporal se reintente con espera creciente y que uno permanente deje de
  // repetirse solo. Un reintento manual es otra cosa, porque alguien miro el
  // mensaje y decidio, asi que se le concede un intento propio.
  //
  // Se concede bajando el contador justo por debajo del limite en lugar de
  // ponerlo a cero: el reclamo lo vuelve a subir, de modo que si falla otra vez
  // queda agotado y no reingresa a la cola automatica. Un clic, un envio.
  //
  // Sin esto, reintentar un mensaje con los intentos agotados dejaba el registro
  // marcado FALLIDO y luego no lograba reclamarlo: un SIMULADO acababa contado
  // como fallo sin que se hubiera intentado enviar nada.
  await prisma.outboundMessage.update({
    where: { id },
    data: {
      status: "FALLIDO",
      cancelledAt: null,
      error: null,
      attemptCount: Math.min(message.attemptCount, MAX_ATTEMPTS - 1),
      nextAttemptAt: null,
    },
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
