import { prisma } from "@/lib/db";

/**
 * Historia de un participante, leida de las tablas que ya existen.
 *
 * No hay tabla de timeline. Copiar cada hecho a un registro propio obligaria a
 * mantener dos verdades y, en cuanto una escritura fallara, la copia mentiria
 * sobre lo que paso. Aqui se leen las fuentes reales y se ordenan.
 *
 * Nada de lo que sale de aqui contiene respuesta del proveedor, cabeceras,
 * tokens ni objetos completos de Finance: la ficha de un contacto no es el
 * sitio para depurar integraciones.
 */

export type CategoriaTimeline = "MESSAGES" | "COMMERCE" | "AUTOMATION" | "SYSTEM";

export type EventoTimeline = {
  id: string;
  timestamp: string;
  category: CategoriaTimeline;
  type: string;
  title: string;
  description: string | null;
  status: string | null;
  source: string;
};

export const CATEGORIAS: readonly { key: "ALL" | CategoriaTimeline; label: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "MESSAGES", label: "Mensajes" },
  { key: "COMMERCE", label: "Comercio" },
  { key: "AUTOMATION", label: "Automatización" },
  { key: "SYSTEM", label: "Sistema" },
];

/** Tope duro: la ficha nunca carga el historial entero de una vez. */
export const MAX_EVENTOS = 60;

const MODALIDAD: Record<string, string> = {
  FULL: "Certificación completa",
  INSTITUTIONAL: "Certificado institucional",
  AVAL_UPGRADE: "Mejora con aval externo",
};

const ESTADO_COMPRA: Record<string, string> = {
  PENDING: "Registrada",
  SENT_TO_FINANCE: "Enviada a Finance",
  PAYMENT_PENDING: "Pago pendiente",
  PAYMENT_VERIFIED: "Pago verificado",
  CANCELLED: "Cancelada",
  ERROR: "Con error",
};

function recorte(texto: string | null | undefined, largo = 140): string | null {
  if (!texto) return null;
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio;
}

/** Nombre legible del momento del plan, sin exponer la clave tecnica. */
const MOMENTOS: Record<string, string> = {
  welcome: "Bienvenida",
  whatsapp_group: "Grupo de WhatsApp",
  reminder_24h: "Recordatorio 24 horas",
  reminder_2h: "Acceso 2 horas",
  reminder_15m: "Acceso 15 minutos",
  session_live: "Sesión en vivo",
  late_access: "Acceso para rezagados",
  thank_you: "Fin de sesión",
  course_complete: "Curso completo",
  course_follow_up: "Seguimiento",
  survey: "Encuesta",
  certification_offer: "Oferta institucional",
};

export type OpcionesTimeline = {
  category?: "ALL" | CategoriaTimeline;
  limit?: number;
  /** ISO del evento mas antiguo ya mostrado: se piden los anteriores. */
  before?: string;
};

/**
 * Reune la actividad del contacto.
 *
 * Cada fuente se consulta con su propio tope y luego se ordena en memoria. Es
 * deliberado: seis consultas acotadas son mucho mas baratas que un `UNION` que
 * obligaria a mantener sincronizadas seis formas distintas de fila.
 */
export async function construirTimeline(leadId: string, opciones: OpcionesTimeline = {}) {
  const limite = Math.min(opciones.limit ?? MAX_EVENTOS, MAX_EVENTOS);
  const corte = opciones.before ? new Date(opciones.before) : null;
  const antes = corte ? { lt: corte } : undefined;
  const porFuente = limite + 1;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, createdAt: true, fullName: true },
  });
  if (!lead) return null;

  const [inscripciones, compras, salientes, entrantes, conversaciones, ofertas, eventos] = await Promise.all([
    prisma.enrollment.findMany({
      where: { leadId, ...(antes ? { createdAt: antes } : {}) },
      select: { id: true, createdAt: true, status: true, fullCourseAccessEntitled: true, fullCourseAccessEntitledAt: true, course: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: porFuente,
    }),
    prisma.coursePurchase.findMany({
      where: { enrollment: { leadId }, ...(antes ? { createdAt: antes } : {}) },
      select: { id: true, createdAt: true, offerType: true, status: true, amount: true, paymentVerifiedAt: true },
      orderBy: { createdAt: "desc" },
      take: porFuente,
    }),
    prisma.outboundMessage.findMany({
      where: { leadId, ...(antes ? { scheduledAt: antes } : {}) },
      select: {
        id: true, channel: true, status: true, origin: true, scheduledAt: true, acceptedAt: true, body: true,
        humanActor: { select: { name: true } },
        automationRule: { select: { planKey: true, name: true } },
      },
      orderBy: { scheduledAt: "desc" },
      take: porFuente,
    }),
    prisma.inboundMessage.findMany({
      where: { leadId, ...(antes ? { occurredAt: antes } : {}) },
      select: { id: true, type: true, text: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: porFuente,
    }),
    prisma.conversation.findMany({
      where: { leadId },
      select: { id: true, handoffAt: true, resolvedAt: true, assignedTo: { select: { name: true } } },
      take: 5,
    }),
    prisma.certificationOfferRecipient.findMany({
      where: { enrollment: { leadId } },
      select: { id: true, eligibilityStatus: true, manualSentAt: true, automaticSentAt: true, createdAt: true, campaign: { select: { audienceMode: true } } },
      orderBy: { createdAt: "desc" },
      take: porFuente,
    }),
    prisma.leadEvent.findMany({
      where: { leadId, ...(antes ? { createdAt: antes } : {}) },
      select: { id: true, type: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: porFuente,
    }),
  ]);

  const eventosTimeline: EventoTimeline[] = [];
  const agregar = (evento: EventoTimeline) => {
    if (corte && new Date(evento.timestamp) >= corte) return;
    eventosTimeline.push(evento);
  };

  agregar({
    id: `lead:${lead.id}`,
    timestamp: lead.createdAt.toISOString(),
    category: "SYSTEM",
    type: "LEAD_CREATED",
    title: "Contacto registrado",
    description: null,
    status: null,
    source: "Lead",
  });

  for (const e of inscripciones) {
    agregar({
      id: `enr:${e.id}`,
      timestamp: e.createdAt.toISOString(),
      category: "COMMERCE",
      type: "ENROLLMENT_CREATED",
      title: `Inscripción · ${e.course.title}`,
      description: null,
      status: e.status,
      source: "Enrollment",
    });
    if (e.fullCourseAccessEntitled && e.fullCourseAccessEntitledAt) {
      agregar({
        id: `ent:${e.id}`,
        timestamp: e.fullCourseAccessEntitledAt.toISOString(),
        category: "COMMERCE",
        type: "ENTITLEMENT_GRANTED",
        title: "Acceso al curso completo concedido",
        description: e.course.title,
        status: null,
        source: "Enrollment",
      });
    }
  }

  for (const c of compras) {
    // El importe se muestra como dato, nunca como explicacion de la modalidad:
    // la modalidad la dice `offerType` y solo el.
    agregar({
      id: `buy:${c.id}`,
      timestamp: c.createdAt.toISOString(),
      category: "COMMERCE",
      type: "PURCHASE_CREATED",
      title: `Compra · ${MODALIDAD[c.offerType] ?? c.offerType}`,
      description: `Importe registrado: $${c.amount.toString()}`,
      status: ESTADO_COMPRA[c.status] ?? c.status,
      source: "CoursePurchase",
    });
    if (c.paymentVerifiedAt) {
      agregar({
        id: `pay:${c.id}`,
        timestamp: c.paymentVerifiedAt.toISOString(),
        category: "COMMERCE",
        type: "PAYMENT_VERIFIED",
        title: "Pago verificado",
        description: MODALIDAD[c.offerType] ?? c.offerType,
        status: null,
        source: "CoursePurchase",
      });
    }
  }

  for (const m of salientes) {
    const humano = m.origin === "HUMAN";
    agregar({
      id: `out:${m.id}`,
      timestamp: (m.acceptedAt ?? m.scheduledAt).toISOString(),
      category: humano ? "MESSAGES" : "AUTOMATION",
      type: humano ? "HUMAN_REPLY" : "AUTOMATION_MESSAGE",
      title: humano
        ? `Respuesta de asesor${m.humanActor?.name ? ` · ${m.humanActor.name}` : ""}`
        : `${MOMENTOS[m.automationRule?.planKey ?? ""] ?? m.automationRule?.name ?? "Mensaje automático"} · ${m.channel}`,
      description: recorte(m.body),
      status: m.status,
      source: "OutboundMessage",
    });
  }

  for (const m of entrantes) {
    agregar({
      id: `in:${m.id}`,
      timestamp: m.occurredAt.toISOString(),
      category: "MESSAGES",
      type: "INBOUND_MESSAGE",
      title: "WhatsApp recibido",
      description: recorte(m.text) ?? `Mensaje de tipo ${m.type}`,
      status: null,
      source: "InboundMessage",
    });
  }

  for (const c of conversaciones) {
    if (c.handoffAt) {
      agregar({
        id: `ho:${c.id}`,
        timestamp: c.handoffAt.toISOString(),
        category: "SYSTEM",
        type: "HANDOFF_STARTED",
        title: "Atención humana iniciada",
        description: c.assignedTo?.name ? `Asesor: ${c.assignedTo.name}` : null,
        status: null,
        source: "Conversation",
      });
    }
    if (c.resolvedAt) {
      agregar({
        id: `hr:${c.id}`,
        timestamp: c.resolvedAt.toISOString(),
        category: "SYSTEM",
        type: "HANDOFF_RESOLVED",
        title: "Atención humana cerrada",
        description: null,
        status: null,
        source: "Conversation",
      });
    }
  }

  for (const o of ofertas) {
    // El envio puede haberlo hecho el reloj o una persona; para la ficha da
    // igual cual de los dos, lo que importa es cuando salio.
    const enviado = o.manualSentAt ?? o.automaticSentAt;
    agregar({
      id: `off:${o.id}`,
      timestamp: (enviado ?? o.createdAt).toISOString(),
      category: "COMMERCE",
      type: enviado ? "OFFER_SENT" : "OFFER_PREPARED",
      title: enviado ? "Oferta institucional enviada" : "Oferta institucional preparada",
      description: o.campaign.audienceMode === "HISTORICAL_MANUAL" ? "Campaña histórica (decisión manual)" : "Campaña automática",
      status: o.eligibilityStatus,
      source: "CertificationOffer",
    });
  }

  for (const e of eventos) {
    // Solo los eventos con significado propio: el resto es ruido tecnico que
    // haria ilegible la ficha.
    if (e.type !== "ENROLLMENT_JOURNEY_SCHEDULED") continue;
    agregar({
      id: `ev:${e.id}`,
      timestamp: e.createdAt.toISOString(),
      category: "AUTOMATION",
      type: "JOURNEY_SCHEDULED",
      title: "Journey programado",
      description: null,
      status: null,
      source: "LeadEvent",
    });
  }

  const filtrados = opciones.category && opciones.category !== "ALL"
    ? eventosTimeline.filter((e) => e.category === opciones.category)
    : eventosTimeline;

  const ordenados = filtrados.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const pagina = ordenados.slice(0, limite);

  return {
    lead: { id: lead.id, name: lead.fullName },
    events: pagina,
    nextBefore: ordenados.length > limite ? pagina[pagina.length - 1]?.timestamp ?? null : null,
  };
}
