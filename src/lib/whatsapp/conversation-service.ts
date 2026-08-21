import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { WhatsAppChannel } from "@/lib/nurture/channels/whatsapp";
import { resolveWhatsAppConfig, resolveWhatsAppWindow, toWhatsAppRecipient } from "@/lib/whatsapp/config";
import { buildTemplateComponents, fillTemplateBody, WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from "@/lib/whatsapp/templates";
import { whatsappCustomerServiceWindow } from "@/lib/whatsapp/conversation";

/**
 * Operaciones de la bandeja de WhatsApp.
 *
 * Concentra las decisiones que la interfaz NO puede tomar sola: si la ventana
 * de 24 horas permite texto libre, si una plantilla puede usarse desde aqui, y
 * si un mensaje citado pertenece de verdad a esta conversacion. El panel las
 * muestra, pero quien decide es este modulo.
 */

export const MAX_TEXTO_RESPUESTA = 4_000;

export type FalloRespuesta = { codigo: string; mensaje: string; estado: number };

/**
 * Plantillas que NO pueden dispararse desde la bandeja generica.
 *
 * La oferta institucional la gobiernan las campanas, que deciden elegibilidad
 * comercial. Permitirla aqui seria una puerta lateral para saltarse esa
 * decision desde una conversacion cualquiera.
 */
const SOLO_CAMPANA: ReadonlySet<string> = new Set<WhatsAppTemplateKey>(["certification_offer"]);

export function plantillaUsableEnBandeja(clave: string): FalloRespuesta | null {
  if (!(clave in WHATSAPP_TEMPLATES)) {
    return { codigo: "TEMPLATE_UNKNOWN", mensaje: "Esa plantilla no está en el catálogo aprobado.", estado: 422 };
  }
  if (SOLO_CAMPANA.has(clave)) {
    return { codigo: "TEMPLATE_CAMPAIGN_ONLY", mensaje: "Esta plantilla solo puede enviarse desde una campaña institucional.", estado: 422 };
  }
  return null;
}

/**
 * Estados de OutboundMessage que representan una accion REAL sobre WhatsApp:
 * se intento o se logro entregar, no una intencion futura ni algo que nunca
 * salio.
 *
 * REBOTADO se suma al conjunto que ya sugeria el pedido (ENVIANDO, ACEPTADO,
 * ENVIADO, ENTREGADO, LEIDO, FALLIDO): un rebote es Meta rechazando en firme
 * un mensaje que si se intento enviar -tiene su propio `bouncedAt`-, asi que
 * es tan real como un FALLIDO y merece el mismo trato (aparecer en el chat
 * con su propio estado de error), no desaparecer silenciosamente.
 *
 * Deliberadamente NO incluye PROGRAMADO (todavia no paso), OMITIDO/CANCELADO
 * (se decidio no mandarlo) ni SIMULADO (no toco WhatsApp de verdad): mezclar
 * cualquiera de estos con el historial real es exactamente el bug que este
 * conjunto existe para evitar.
 */
export const ESTADOS_HISTORIAL_REAL = ["ENVIANDO", "ACEPTADO", "ENVIADO", "ENTREGADO", "LEIDO", "REBOTADO", "FALLIDO"] as const;

/**
 * Momento real en que un saliente ocurrio (o se intento), para ubicarlo en el
 * historial.
 *
 * `readAt`/`deliveredAt` quedan fuera a proposito: son ESTADOS posteriores
 * del mismo mensaje, no otro momento en el que reubicarlo -un mensaje leido
 * dos dias despues no "se mueve" a esa fecha en el chat-. `scheduledAt` es el
 * ultimo recurso (p.ej. ENVIANDO, que puede no tener aun ningun timestamp
 * propio) y para los estados reales nunca cae en el futuro, porque el
 * despachador solo los toca en o despues de su hora programada.
 */
export function outboundEfectivoAt(m: {
  scheduledAt: Date;
  acceptedAt: Date | null;
  sentAt: Date | null;
  failedAt: Date | null;
  bouncedAt: Date | null;
}): Date {
  return m.acceptedAt ?? m.sentAt ?? m.failedAt ?? m.bouncedAt ?? m.scheduledAt;
}

/** Ventana de la conversacion, calculada siempre en el mismo sitio. */
export function ventanaDe(lastInboundAt: Date | null | undefined, ahora = new Date()) {
  const ventana = whatsappCustomerServiceWindow(lastInboundAt, ahora);
  return {
    open: ventana.abierta,
    expiresAt: ventana.abierta ? ventana.expiraEn.toISOString() : null,
    remainingSeconds: ventana.abierta ? Math.floor(ventana.restanteMs / 1000) : 0,
    reason: ventana.abierta ? null : ventana.motivo,
  };
}

/**
 * Variables de plantilla resueltas desde el contexto real.
 *
 * No acepta valores del navegador: quien enviara el mensaje es el CRM, y dejar
 * que la interfaz dicte el contenido de una plantilla aprobada permitiria
 * escribir cualquier cosa dentro de un formato que Meta reviso.
 */
export function variablesDeContexto(input: {
  nombre?: string | null;
  curso?: string | null;
  linkGrupo?: string | null;
  linkCursoCompleto?: string | null;
  linkEncuesta?: string | null;
  streamUrl?: string | null;
  fechaSesion?: string | null;
  horaSesion?: string | null;
  numeroSesion?: string | null;
  totalSesiones?: string | null;
  proximaSesion?: string | null;
}): Record<string, string> {
  const vars: Record<string, string> = {};
  const poner = (clave: string, valor: string | null | undefined) => {
    if (valor?.trim()) vars[clave] = valor.trim();
  };
  poner("nombre", input.nombre);
  poner("curso", input.curso);
  poner("link_grupo_whatsapp", input.linkGrupo);
  poner("link_curso_completo", input.linkCursoCompleto);
  poner("link_encuesta", input.linkEncuesta);
  poner("streamUrl", input.streamUrl);
  poner("fechaSesion", input.fechaSesion);
  poner("horaSesion", input.horaSesion);
  poner("numero_sesion", input.numeroSesion);
  poner("total_sesiones", input.totalSesiones);
  poner("proxima_sesion", input.proximaSesion);
  return vars;
}

export type PreparacionEnvio =
  | { ok: true; cuerpo: string; template?: { name: string; language: string; components: unknown[] } }
  | { ok: false; fallo: FalloRespuesta };

/**
 * Valida y arma lo que se enviara, sin contactar todavia con Meta.
 *
 * Separar la validacion del envio permite rechazar sin gastar una llamada al
 * proveedor, que es lo que se quiere cuando la ventana esta cerrada o la
 * plantilla no procede.
 */
export function prepararEnvio(input: {
  modo: "text" | "template";
  texto?: string;
  templateKey?: string;
  ventanaAbierta: boolean;
  variables: Record<string, string>;
}): PreparacionEnvio {
  if (input.modo === "text") {
    if (!input.ventanaAbierta) {
      return {
        ok: false,
        fallo: {
          codigo: "WINDOW_CLOSED_TEMPLATE_REQUIRED",
          mensaje: "Han pasado más de 24 horas desde el último mensaje del contacto. Usa una plantilla aprobada.",
          estado: 409,
        },
      };
    }
    const texto = (input.texto ?? "").trim();
    if (!texto) return { ok: false, fallo: { codigo: "TEXT_EMPTY", mensaje: "El mensaje está vacío.", estado: 422 } };
    return { ok: true, cuerpo: texto.slice(0, MAX_TEXTO_RESPUESTA) };
  }

  const clave = input.templateKey ?? "";
  const problema = plantillaUsableEnBandeja(clave);
  if (problema) return { ok: false, fallo: problema };

  const spec = WHATSAPP_TEMPLATES[clave as WhatsAppTemplateKey];
  const construido = buildTemplateComponents(
    { name: spec.name, language: spec.language, bodyVars: [...spec.bodyVars], urlVar: spec.urlVar ?? null },
    input.variables,
  );
  if (!construido.ok) {
    // Falta contexto real (un enlace, una fecha): no se inventa un valor para
    // rellenar el hueco, porque llegaria al contacto como si fuera cierto.
    return {
      ok: false,
      fallo: { codigo: "TEMPLATE_CONTEXT_MISSING", mensaje: construido.error, estado: 422 },
    };
  }
  return {
    ok: true,
    cuerpo: fillTemplateBody(spec, (variable) => input.variables[variable] ?? ""),
    template: { name: spec.name, language: spec.language, components: construido.components },
  };
}

/**
 * ¿El mensaje citado pertenece a esta conversacion?
 *
 * Sin esta comprobacion, alterar el wamid en la peticion permitiria citar el
 * mensaje de otra persona, y Meta lo mostraria como si formara parte de este
 * hilo.
 */
export async function contextoValido(conversationPhone: string, providerMessageId: string): Promise<boolean> {
  const entrante = await prisma.inboundMessage.findFirst({
    where: { providerMessageId, fromPhone: conversationPhone },
    select: { id: true },
  });
  if (entrante) return true;
  const saliente = await prisma.outboundMessage.findFirst({
    where: { providerMessageId, conversation: { phone: conversationPhone } },
    select: { id: true },
  });
  return Boolean(saliente);
}

export type ResultadoEnvioHumano =
  | { ok: true; outboundId: string; providerMessageId: string | null; duplicado: boolean }
  | { ok: false; fallo: FalloRespuesta };

/**
 * Envia la respuesta humana y la deja en el historial como un saliente mas.
 *
 * Reutiliza `OutboundMessage` a proposito: asi los estados sent/delivered/read
 * que ya llegan por el webhook actualizan tambien estas respuestas, sin una
 * segunda tuberia que mantener.
 *
 * El registro se crea ANTES de llamar a Meta. Si la conexion se corta despues
 * de que Meta acepte, queda un mensaje en ENVIANDO —visible y sin duplicar— en
 * lugar de un envio fantasma que un reintento repetiria.
 */
export async function enviarRespuestaHumana(input: {
  conversationId: string;
  conversationPhone: string;
  leadId: string;
  enrollmentId: string | null;
  /** Null en sesiones legacy, que no tienen usuario en la tabla. */
  actorId: string | null;
  clientRequestId: string;
  cuerpo: string;
  template?: { name: string; language: string; components: unknown[] };
  replyToProviderMessageId?: string;
}): Promise<ResultadoEnvioHumano> {
  let outboundId: string;
  try {
    const creado = await prisma.outboundMessage.create({
      data: {
        leadId: input.leadId,
        enrollmentId: input.enrollmentId,
        conversationId: input.conversationId,
        humanActorId: input.actorId,
        clientRequestId: input.clientRequestId,
        origin: "HUMAN",
        channel: "WHATSAPP",
        toAddress: input.conversationPhone,
        body: input.cuerpo,
        status: "ENVIANDO",
        scheduledAt: new Date(),
        attempts: 1,
        attemptCount: 1,
        lastAttemptAt: new Date(),
        waTemplate: (input.template ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    outboundId = creado.id;
  } catch (error: unknown) {
    // P2002 sobre (conversationId, clientRequestId): el panel repitio la misma
    // peticion. Se devuelve lo que ya existe en lugar de enviar otro WhatsApp.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const previo = await prisma.outboundMessage.findFirst({
        where: { conversationId: input.conversationId, clientRequestId: input.clientRequestId },
        select: { id: true, providerMessageId: true },
      });
      return { ok: true, outboundId: previo?.id ?? "", providerMessageId: previo?.providerMessageId ?? null, duplicado: true };
    }
    throw error;
  }

  const config = resolveWhatsAppConfig();
  const resultado = await new WhatsAppChannel({
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    graphVersion: config.graphVersion,
  }).send({
    to: toWhatsAppRecipient(input.conversationPhone),
    body: input.cuerpo,
    template: input.template as { name: string; language: string; components: never[] } | undefined,
    contextMessageId: input.replyToProviderMessageId,
    reference: `human:${input.clientRequestId}`,
  });

  if (!resultado.ok) {
    await prisma.outboundMessage.update({
      where: { id: outboundId },
      data: {
        status: "FALLIDO",
        failedAt: new Date(),
        errorCode: resultado.errorCode?.slice(0, 120) ?? "PROVIDER_ERROR",
        errorMessage: resultado.error?.slice(0, 500) ?? "No se pudo enviar.",
        providerName: resultado.providerName,
      },
    });
    return { ok: false, fallo: { codigo: resultado.errorCode ?? "PROVIDER_ERROR", mensaje: resultado.error ?? "No se pudo enviar.", estado: 502 } };
  }

  await prisma.outboundMessage.update({
    where: { id: outboundId },
    data: {
      status: "ACEPTADO",
      acceptedAt: new Date(),
      providerMessageId: resultado.providerMessageId ?? null,
      providerName: resultado.providerName,
    },
  });
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { lastOutboundAt: new Date() },
  });

  return { ok: true, outboundId, providerMessageId: resultado.providerMessageId ?? null, duplicado: false };
}

/** ¿El canal esta en condiciones de enviar de verdad? */
export function canalListo(): FalloRespuesta | null {
  const ventana = resolveWhatsAppWindow();
  if (ventana.state === "live") return null;
  return {
    codigo: ventana.state === "simulation" ? "CHANNEL_SIMULATION" : "CHANNEL_BLOCKED",
    mensaje: ventana.state === "simulation"
      ? "El canal de WhatsApp está en simulación, así que no se envió nada."
      : ventana.error,
    estado: 409,
  };
}

/**
 * Avisa a Meta de que los mensajes se leyeron.
 *
 * Devuelve un aviso en lugar de lanzar: la lectura local ya esta guardada y un
 * fallo del proveedor no puede deshacerla. Se recorta el lote porque marcar
 * cientos de uno en uno alargaria la peticion del panel sin necesidad.
 */
export async function marcarLeidoEnMeta(providerMessageIds: readonly string[]): Promise<string | null> {
  const config = resolveWhatsAppConfig();
  if (resolveWhatsAppWindow().state !== "live") return null;
  const fallos: string[] = [];
  for (const id of providerMessageIds.slice(0, 20)) {
    try {
      const res = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: id }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) fallos.push(String(res.status));
    } catch {
      fallos.push("red");
    }
  }
  return fallos.length > 0 ? `No se pudo confirmar la lectura de ${fallos.length} mensaje(s) en WhatsApp.` : null;
}
