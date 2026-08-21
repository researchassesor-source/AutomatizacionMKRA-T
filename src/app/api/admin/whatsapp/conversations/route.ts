import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { OPERACION } from "@/lib/auth/roles";
import { ESTADOS_HISTORIAL_REAL, outboundEfectivoAt, ventanaDe } from "@/lib/whatsapp/conversation-service";

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
 *
 * `lastMessage` es el ultimo mensaje REAL de la conversacion -entrante, humano
 * saliente, o automatico ya enviado-, nunca un PROGRAMADO futuro (el filtro de
 * status ya lo excluye de la consulta). Antes solo miraba InboundMessage, asi
 * que un contacto al que un asesor o un automatico le acababan de contestar
 * seguia mostrando lo que EL habia escrito antes, como si nadie le hubiera
 * respondido.
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
   * El ultimo mensaje real de CADA conversacion puede venir de tres sitios
   * -lo que escribio el contacto, una respuesta humana, o un automatico ya
   * enviado-, y los tres se resuelven en consultas agrupadas (no una por
   * conversacion): con cincuenta filas eso serian ciento cincuenta viajes a
   * la base cada vez que alguien abre la bandeja.
   *
   * Antes, `lastMessage` solo miraba InboundMessage: si el ultimo mensaje
   * real lo mando un asesor o salio un automatico, la lista seguia
   * mostrando lo que el contacto habia escrito ANTES de eso, como si nadie
   * le hubiera contestado todavia.
   */
  const telefonos = pagina.map((c) => c.phone);
  const conversationIds = pagina.map((c) => c.id);
  const leadIds = pagina.map((c) => c.leadId).filter((leadId): leadId is string => Boolean(leadId));

  const [noLeidos, ultimosEntrantes, ultimosSalientes] = await Promise.all([
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
    prisma.outboundMessage.findMany({
      where: {
        channel: "WHATSAPP",
        status: { in: [...ESTADOS_HISTORIAL_REAL] },
        OR: [{ conversationId: { in: conversationIds } }, ...(leadIds.length ? [{ leadId: { in: leadIds } }] : [])],
      },
      select: {
        conversationId: true, leadId: true, origin: true, body: true,
        scheduledAt: true, acceptedAt: true, sentAt: true, failedAt: true, bouncedAt: true,
      },
      orderBy: { scheduledAt: "desc" },
      take: (conversationIds.length || 1) * 3,
    }),
  ]);
  const porTelefono = new Map(noLeidos.map((n) => [n.fromPhone, n._count]));
  const entranteDe = new Map<string, (typeof ultimosEntrantes)[number]>();
  for (const m of ultimosEntrantes) if (!entranteDe.has(m.fromPhone)) entranteDe.set(m.fromPhone, m);

  // Los automaticos anteriores a que existiera la conversacion solo referencian
  // al lead: se busca por las dos claves y se usa la que resulte mas reciente.
  const salienteDeConversacion = new Map<string, (typeof ultimosSalientes)[number]>();
  const salienteDeLead = new Map<string, (typeof ultimosSalientes)[number]>();
  for (const m of ultimosSalientes) {
    if (m.conversationId && !salienteDeConversacion.has(m.conversationId)) salienteDeConversacion.set(m.conversationId, m);
    if (m.leadId && !salienteDeLead.has(m.leadId)) salienteDeLead.set(m.leadId, m);
  }

  type UltimoMensaje = { at: Date; preview: string; direction: "INBOUND" | "OUTBOUND"; origin: "CONTACT" | "HUMAN" | "AUTOMATION" };

  const items = pagina.map((c) => {
    const entrante = entranteDe.get(c.phone);
    const porConversacion = salienteDeConversacion.get(c.id);
    const porLead = c.leadId ? salienteDeLead.get(c.leadId) : undefined;
    const saliente = [porConversacion, porLead]
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .sort((a, b) => outboundEfectivoAt(b).getTime() - outboundEfectivoAt(a).getTime())[0];

    const candidatos: UltimoMensaje[] = [];
    if (entrante) candidatos.push({ at: entrante.occurredAt, preview: entrante.text ?? `[${entrante.type}]`, direction: "INBOUND", origin: "CONTACT" });
    if (saliente) {
      candidatos.push({
        at: outboundEfectivoAt(saliente),
        preview: saliente.body,
        direction: "OUTBOUND",
        origin: saliente.origin === "HUMAN" ? "HUMAN" : "AUTOMATION",
      });
    }
    // NUNCA PROGRAMADO futuro: el filtro de status ya lo excluyo de la consulta,
    // asi que el candidato mas reciente entre estos dos siempre es real.
    const ultimo = candidatos.sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;

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
      lastMessage: ultimo
        ? { preview: ultimo.preview.slice(0, 120), at: ultimo.at.toISOString(), direction: ultimo.direction, origin: ultimo.origin }
        : null,
      window: ventanaDe(c.lastInboundAt),
    };
  });

  /**
   * La pagina se sigue recortando por `lastInboundAt` (la cursor-pagination de
   * arriba depende de ese orden para no saltarse ni repetir filas), pero DENTRO
   * de esa pagina ya recuperada, se muestra por actividad real mas reciente de
   * verdad -nunca por un automatico futuro, que ni siquiera entra aqui porque
   * el filtro de status ya lo excluyo-.
   */
  items.sort((a, b) => (b.lastMessage ? new Date(b.lastMessage.at).getTime() : 0) - (a.lastMessage ? new Date(a.lastMessage.at).getTime() : 0));

  return NextResponse.json({
    ok: true,
    conversations: items,
    nextCursor: hayMas ? pagina[pagina.length - 1]?.id ?? null : null,
  });
}
