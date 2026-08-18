import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { OPERACION } from "@/lib/auth/roles";
import { ventanaDe } from "@/lib/whatsapp/conversation-service";

export const dynamic = "force-dynamic";

const MAX_POR_PAGINA = 50;

/** Deja visibles los ultimos digitos, que bastan para reconocer el numero. */
function telefonoParcial(phone: string): string {
  return `…${phone.slice(-4)}`;
}

const schema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_POR_PAGINA).default(25),
  cursor: z.string().trim().max(40).optional(),
  search: z.string().trim().max(80).optional(),
  state: z.enum(["AUTOMATION", "HUMAN_HANDOFF", "RESOLVED"]).optional(),
});

/**
 * Lista de conversaciones para la bandeja.
 *
 * Devuelve lo justo para pintar el panel izquierdo. El numero va recortado: una
 * lista completa de telefonos en pantalla es un dato personal expuesto sin que
 * nadie lo haya pedido, y para reconocer una conversacion bastan los ultimos
 * digitos.
 */
export async function GET(request: Request) {
  const auth = await requireRole(request, OPERACION);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Parámetros no válidos." }, { status: 422 });
  const { limit, cursor, search, state } = parsed.data;

  const filtro = {
    ...(state ? { state } : {}),
    ...(search
      ? {
          OR: [
            { phone: { contains: search } },
            { lead: { fullName: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const conversaciones = await prisma.conversation.findMany({
    where: filtro,
    select: {
      id: true, phone: true, state: true, lastInboundAt: true, lastOutboundAt: true, leadId: true,
      assignedTo: { select: { id: true, name: true } },
      lead: { select: { id: true, fullName: true } },
    },
    orderBy: [{ lastInboundAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hayMas = conversaciones.length > limit;
  const pagina = hayMas ? conversaciones.slice(0, limit) : conversaciones;

  /**
   * Los no leidos y el ultimo mensaje se resuelven en DOS consultas agrupadas,
   * no en una por conversacion: con cincuenta filas eso serian cien viajes a la
   * base cada vez que alguien abre la bandeja.
   */
  const telefonos = pagina.map((c) => c.phone);
  const [noLeidos, ultimos] = await Promise.all([
    prisma.inboundMessage.groupBy({
      by: ["fromPhone"],
      where: { fromPhone: { in: telefonos }, readAt: null },
      _count: true,
    }),
    prisma.inboundMessage.findMany({
      where: { fromPhone: { in: telefonos } },
      select: { fromPhone: true, text: true, type: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: telefonos.length * 3,
    }),
  ]);
  const porTelefono = new Map(noLeidos.map((n) => [n.fromPhone, n._count]));
  const ultimoDe = new Map<string, (typeof ultimos)[number]>();
  for (const m of ultimos) if (!ultimoDe.has(m.fromPhone)) ultimoDe.set(m.fromPhone, m);

  return NextResponse.json({
    ok: true,
    conversations: pagina.map((c) => {
      const ultimo = ultimoDe.get(c.phone);
      return {
        id: c.id,
        name: c.lead?.fullName ?? "Contacto sin vincular",
        phonePartial: telefonoParcial(c.phone),
        linked: Boolean(c.leadId),
        state: c.state,
        assignedTo: c.assignedTo,
        lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
        lastOutboundAt: c.lastOutboundAt?.toISOString() ?? null,
        unreadCount: porTelefono.get(c.phone) ?? 0,
        // Resumen corto: la lista no es el sitio para leer el mensaje entero.
        lastMessage: ultimo ? { preview: (ultimo.text ?? `[${ultimo.type}]`).slice(0, 120), at: ultimo.occurredAt.toISOString() } : null,
        window: ventanaDe(c.lastInboundAt),
      };
    }),
    nextCursor: hayMas ? pagina[pagina.length - 1]?.id ?? null : null,
  });
}
