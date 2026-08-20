import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { normalizeEcuadorPhone } from "@/lib/lead-validation";
import { debeAbrirHandoff } from "@/lib/whatsapp/conversation";
import type { InboundNotice } from "@/lib/whatsapp/webhook";

/**
 * Guarda lo que entra por WhatsApp y abre la atencion humana.
 *
 * Se ejecuta dentro del webhook, que Meta reintenta ante cualquier respuesta
 * distinta de 200. Por eso todo aqui esta pensado para repetirse sin
 * consecuencias: el wamid es unico, la conversacion se hace upsert y el
 * handoff no se reabre si ya estaba abierto.
 */

export type ResultadoInbound =
  | { estado: "guardado"; inboundId: string; leadId: string | null; handoffAbierto: boolean }
  | { estado: "duplicado" }
  /** Definitivo: reintentarlo daria exactamente el mismo resultado. */
  | { estado: "invalido"; motivo: string }
  /**
   * Transitorio: la base fallo. Quien llama debe pedir a Meta que reintente,
   * porque un 200 aqui haria que diera el webhook por entregado y el mensaje se
   * perderia sin dejar rastro.
   */
  | { estado: "reintentable"; codigo: string };

/**
 * Telefono en el formato canonico del CRM.
 *
 * Meta entrega el numero sin `+` y a veces sin el cero nacional. Se reutiliza
 * la normalizacion del CRM para que la clave de conversacion y la busqueda de
 * contacto usen exactamente la misma forma; una segunda implementacion aqui
 * seria la manera de que dejaran de encontrarse entre si.
 */
export function normalizarRemitente(sender: string): string | null {
  const candidatos = sender.startsWith("+") ? [sender] : [`+${sender}`, sender];
  for (const candidato of candidatos) {
    try {
      return normalizeEcuadorPhone(candidato);
    } catch {
      // Se prueba la siguiente forma.
    }
  }
  return null;
}

/**
 * Contacto al que pertenece el numero, solo si es inequivoco.
 *
 * Con varias coincidencias no se elige: vincular la conversacion al contacto
 * equivocado mezclaria el historial de dos personas, y deshacerlo despues es
 * mucho mas caro que dejarlo sin vincular para que alguien lo revise.
 */
async function resolverContacto(telefono: string) {
  const candidatos = await prisma.lead.findMany({
    where: { phone: telefono },
    select: { id: true, assignedToId: true },
    take: 2,
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * Inscripcion a la que atribuir el mensaje, solo si hay UNA viva.
 *
 * No se deduce por curso mas reciente ni por lo que diga el texto: el Inbox
 * permitira resolverlo a mano, y una atribucion equivocada ensucia el historial
 * de una inscripcion ajena.
 */
async function resolverInscripcion(leadId: string) {
  const activas = await prisma.enrollment.findMany({
    where: { leadId, status: { in: ["INTERESADO", "INSCRITO", "EN_CURSO"] } },
    select: { id: true },
    take: 2,
  });
  return activas.length === 1 ? activas[0].id : null;
}

/**
 * Persiste un mensaje entrante y deja la conversacion en atencion humana.
 *
 * Nunca crea un contacto: recibir un WhatsApp no convierte a nadie en lead con
 * consentimiento, y darlo de alta en silencio meteria a esa persona en
 * automatizaciones que no pidio. Tampoco toca `classification` ni `consent` de
 * un contacto existente por el mismo motivo.
 */
export async function guardarMensajeEntrante(notice: InboundNotice): Promise<ResultadoInbound> {
  const telefono = normalizarRemitente(notice.sender);
  if (!telefono) return { estado: "invalido", motivo: "TELEFONO_NO_NORMALIZABLE" };

  const contacto = await resolverContacto(telefono);
  const leadId = contacto?.id ?? null;
  const enrollmentId = leadId ? await resolverInscripcion(leadId) : null;

  let inboundId: string;
  let esDuplicado = false;
  try {
    const guardado = await prisma.inboundMessage.create({
      data: {
        providerMessageId: notice.providerMessageId,
        fromPhone: telefono,
        toPhoneNumberId: notice.phoneNumberId ?? null,
        type: notice.type,
        text: notice.text ?? null,
        mediaMeta: (notice.mediaMeta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        contextMessageId: notice.contextMessageId ?? null,
        occurredAt: notice.occurredAt,
        leadId,
        enrollmentId,
      },
      select: { id: true },
    });
    inboundId = guardado.id;
  } catch (error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      // Cualquier otro fallo de escritura es transitorio hasta que se demuestre
      // lo contrario: se pide reintento en lugar de perder el mensaje.
      return { estado: "reintentable", codigo: error instanceof Prisma.PrismaClientKnownRequestError ? `PRISMA_${error.code}` : "PERSISTENCIA_FALLIDA" };
    }
    /**
     * P2002 sobre el wamid: Meta reenvio el mismo webhook.
     *
     * El mensaje ya esta guardado, pero eso NO implica que la reparacion
     * anterior haya llegado hasta el final: el primer intento pudo guardar el
     * InboundMessage y morir justo antes o durante el upsert de Conversation
     * (el catch de mas abajo pide "reintentable" exactamente para este caso).
     * Cortar aqui con "duplicado" dejaria esa Conversation rota para siempre,
     * porque Meta no vuelve a reenviar un wamid que ya considera entregado.
     * Por eso el reintento SIGUE hacia la resolucion de Conversation en vez de
     * salir: repetir el upsert de una conversacion ya sana es barato e
     * idempotente, y repararla cuando hizo falta es la unica oportunidad real.
     */
    const existente = await prisma.inboundMessage.findUnique({
      where: { providerMessageId: notice.providerMessageId },
      select: { id: true },
    });
    // Si no se encuentra (borrado manual entre el intento y este, caso
    // extremo), no hay nada que reparar bajo esta identidad: se trata como
    // definitivo en vez de reintentar para siempre el mismo choque.
    if (!existente) return { estado: "duplicado" };
    inboundId = existente.id;
    esDuplicado = true;
  }

  const conversacion = await prisma.conversation.findUnique({
    where: { phone: telefono },
    select: { state: true, lastInboundAt: true, assignedToId: true, leadId: true },
  });

  const abrirHandoff = debeAbrirHandoff(conversacion?.state);
  /**
   * `lastInboundAt` nunca retrocede.
   *
   * Un webhook atrasado puede llegar despues de uno mas nuevo. Si moviera la
   * marca hacia atras, cerraria la ventana de 24 horas antes de tiempo y el
   * asesor perderia la posibilidad de responder con texto libre.
   */
  const ultimoEntrante = conversacion?.lastInboundAt && conversacion.lastInboundAt > notice.occurredAt
    ? conversacion.lastInboundAt
    : notice.occurredAt;

  const estadoHandoff = { state: "HUMAN_HANDOFF" as const, handoffAt: new Date(), handoffBy: "whatsapp-inbound" };

  try {
    await prisma.conversation.upsert({
    where: { phone: telefono },
    create: {
      phone: telefono,
      leadId,
      // Hereda el asesor del contacto si lo tiene: es quien ya lo atendia.
      assignedToId: contacto?.assignedToId ?? null,
      lastInboundAt: notice.occurredAt,
      ...estadoHandoff,
    },
    update: {
      lastInboundAt: ultimoEntrante,
      // Solo se rellena lo que falta. Una asociacion o una asignacion hecha a
      // mano manda sobre lo que deduzca el webhook.
      ...(conversacion?.leadId ? {} : leadId ? { leadId } : {}),
      ...(conversacion?.assignedToId ? {} : contacto?.assignedToId ? { assignedToId: contacto.assignedToId } : {}),
      // Si ya estaba en atencion humana se conserva su `handoffAt` original:
      // reabrirlo en cada mensaje falsearia cuando empezo la conversacion.
      ...(abrirHandoff ? estadoHandoff : {}),
    },
    });
  } catch {
    // El mensaje ya esta guardado; lo que falto es la conversacion. Se pide
    // reintento: al repetirse, el mensaje sera duplicado seguro y solo se
    // rehara el upsert.
    return { estado: "reintentable", codigo: "CONVERSACION_NO_PERSISTIDA" };
  }

  if (abrirHandoff) {
    await writeAudit({
      actorEmail: "whatsapp-webhook",
      action: "WHATSAPP_HANDOFF_STARTED",
      entityType: "Conversation",
      entityId: telefono,
      // Ni el texto ni el numero completo: basta el tipo para entender que paso.
      metadata: { motivo: "INBOUND", tipo: notice.type, vinculado: Boolean(leadId) },
    }).catch(() => undefined);
  }

  // El mensaje sigue siendo un reenvio de Meta bajo el mismo wamid, aunque
  // esta vuelta si haya reparado la Conversation: la fila de InboundMessage
  // no se duplico, asi que la clasificacion correcta sigue siendo duplicado.
  if (esDuplicado) return { estado: "duplicado" };
  return { estado: "guardado", inboundId, leadId, handoffAbierto: abrirHandoff };
}
