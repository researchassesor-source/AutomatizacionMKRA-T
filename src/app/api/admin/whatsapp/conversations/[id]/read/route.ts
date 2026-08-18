import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { OPERACION } from "@/lib/auth/roles";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { marcarLeidoEnMeta } from "@/lib/whatsapp/conversation-service";

export const dynamic = "force-dynamic";

const schema = z.object({ confirm: z.literal(true).optional() }).optional();

/**
 * Marca como leidos los entrantes de una conversacion.
 *
 * La lectura local manda. Avisar a Meta es cortesia hacia el contacto —le
 * aparecen los dos ticks azules— pero si su API falla, el administrador ya vio
 * los mensajes y deshacer eso seria mentir sobre lo que ocurrio en el panel.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, OPERACION);
  if (auth.error) return auth.error;

  const limit = await checkRateLimit(requestKey(request, "whatsapp-read"), { limit: 120, windowMs: 5 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Demasiadas peticiones seguidas." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  schema.safeParse(await request.json().catch(() => undefined));

  const { id } = await params;
  const conversacion = await prisma.conversation.findUnique({ where: { id }, select: { id: true, phone: true } });
  if (!conversacion) return NextResponse.json({ error: "No se encontró la conversación." }, { status: 404 });

  // Solo los de ESTA conversacion: el filtro por telefono es lo que impide
  // marcar como leidos los mensajes de otra persona alterando el id.
  const pendientes = await prisma.inboundMessage.findMany({
    where: { fromPhone: conversacion.phone, readAt: null },
    select: { id: true, providerMessageId: true },
    orderBy: { occurredAt: "asc" },
    take: 200,
  });

  if (pendientes.length === 0) {
    // Idempotente: repetir no cambia nada y no es un error.
    return NextResponse.json({ ok: true, marcados: 0, providerWarning: null });
  }

  const ahora = new Date();
  await prisma.inboundMessage.updateMany({
    where: { id: { in: pendientes.map((m) => m.id) } },
    data: { readAt: ahora, readByAdminId: auth.session?.userId ?? null },
  });

  // El aviso a Meta va DESPUES y no revierte nada si falla.
  const aviso = await marcarLeidoEnMeta(pendientes.map((m) => m.providerMessageId));

  return NextResponse.json({ ok: true, marcados: pendientes.length, providerWarning: aviso });
}
