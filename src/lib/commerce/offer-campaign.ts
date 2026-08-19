import { Prisma, type CampaignAudienceMode, type FinanceCommercialState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { resolveCourseSessions } from "@/lib/course-sessions";
import { enLotes, getCrmEnrollmentCommerceStates, MAX_COMMERCE_BATCH } from "@/lib/finance/commerce";
import { isChannelSimulation } from "@/lib/nurture/engine";
import { buildTemplateComponents, WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";
import { toWhatsAppRecipient } from "@/lib/whatsapp/config";
import { decidirAutomatico, decidirManual, OFFER_STEP_KEY, offerSequenceKey } from "./offer-eligibility";
import { calcularEnvioAutomatico } from "./offer-schedule";

/**
 * Campaña de oferta de certificacion institucional.
 *
 * Manual y automatico son el MISMO mensaje comercial: comparten la identidad
 * `certification-offer:<courseId>` + `institutional-offer`, de modo que la
 * unicidad de OutboundMessage impide fisicamente que salgan dos veces. Aqui no
 * se confia en un "si ya existe" previo al insert: se intenta crear y se deja
 * que choque la restriccion, que es lo unico que aguanta dos procesos a la vez.
 */

const PLANTILLA = WHATSAPP_TEMPLATES.certification_offer;

export type ResultadoEnvio = {
  encolados: number;
  omitidos: number;
  motivos: Record<string, number>;
};

function sumar(motivos: Record<string, number>, clave: string) {
  motivos[clave] = (motivos[clave] ?? 0) + 1;
}

/**
 * Crea la campaña del curso, o devuelve la que ya existe.
 *
 * El modo se fija al crearla y no se deduce: una campaña historica no puede
 * convertirse en automatica por accidente, porque eso pondria a decidir a
 * Finance sobre datos que no conoce.
 */
export async function asegurarCampana(
  courseId: string,
  audienceMode: CampaignAudienceMode,
  actor?: { email?: string | null },
) {
  const existente = await prisma.certificationOfferCampaign.findUnique({ where: { courseId } });
  if (existente) return existente;

  const curso = await prisma.course.findUnique({
    where: { id: courseId },
    include: { sessions: { orderBy: { startAt: "asc" } } },
  });
  if (!curso) throw new Error("COURSE_NOT_FOUND");

  // Solo las automaticas tienen fecha: una historica sin fecha no puede ser
  // recogida por el cron ni por error.
  const automaticScheduledAt = audienceMode === "AUTOMATIC_COMMERCE"
    ? calcularEnvioAutomatico(resolveCourseSessions(curso, curso.sessions), curso.institutionalOfferDelayHours)
    : null;

  const campana = await prisma.certificationOfferCampaign.create({
    data: {
      courseId,
      audienceMode,
      status: audienceMode === "AUTOMATIC_COMMERCE" && automaticScheduledAt ? "SCHEDULED" : "DRAFT",
      automaticScheduledAt,
    },
  });

  await writeAudit({
    actorEmail: actor?.email ?? "sistema",
    action: "CERT_OFFER_CAMPAIGN_CREATED",
    entityType: "CertificationOfferCampaign",
    entityId: campana.id,
    result: "SUCCESS",
    metadata: { courseId, audienceMode, automaticScheduledAt: automaticScheduledAt?.toISOString() ?? null },
  });
  return campana;
}

/**
 * Da de alta como destinatarios a los inscritos del curso.
 *
 * En modo historico NO se filtra por importe, ni por estado de inscripcion, ni
 * por `financeStatus`: entran todos los inscritos relevantes y decide una
 * persona. Deducir compradores de esos campos seria inventar.
 */
export async function sincronizarDestinatarios(campaignId: string) {
  const campana = await prisma.certificationOfferCampaign.findUnique({ where: { id: campaignId } });
  if (!campana) throw new Error("CAMPAIGN_NOT_FOUND");

  const inscripciones = await prisma.enrollment.findMany({
    where: {
      courseId: campana.courseId,
      status: { not: "CANCELADO" },
      lead: { classification: "REAL", consent: true },
    },
    select: { id: true },
  });

  // createMany + skipDuplicates: reejecutarlo no crea segundas filas ni pisa
  // selecciones ya hechas.
  const creados = await prisma.certificationOfferRecipient.createMany({
    data: inscripciones.map((inscripcion) => ({ campaignId, enrollmentId: inscripcion.id })),
    skipDuplicates: true,
  });
  return { total: inscripciones.length, nuevos: creados.count };
}

/**
 * Recalcula `automaticScheduledAt` cuando el calendario del curso cambió.
 *
 * Sin esto, la oferta institucional automática se quedaba con la fecha
 * calculada el día que se creó la campaña, aunque WordPress moviera después
 * el calendario del curso. Deliberadamente conservador: no crea campañas, no
 * reabre una ya COMPLETED ni toca RUNNING (ya está siendo procesada), y solo
 * escribe si la fecha calculada realmente cambió.
 */
export async function reprogramarOfertaAutomatica(courseId: string, actor?: { email?: string | null } | null) {
  const campana = await prisma.certificationOfferCampaign.findUnique({ where: { courseId } });
  if (campana?.audienceMode !== "AUTOMATIC_COMMERCE") return null;
  if (campana.status !== "SCHEDULED" && campana.status !== "DRAFT") return null;

  const curso = await prisma.course.findUnique({
    where: { id: courseId },
    include: { sessions: { orderBy: { startAt: "asc" } } },
  });
  if (!curso) return null;

  const nuevaFecha = calcularEnvioAutomatico(resolveCourseSessions(curso, curso.sessions), curso.institutionalOfferDelayHours);
  const sinCambio = (nuevaFecha?.getTime() ?? null) === (campana.automaticScheduledAt?.getTime() ?? null);
  if (sinCambio) return null;

  const actualizada = await prisma.certificationOfferCampaign.update({
    where: { id: campana.id },
    data: { automaticScheduledAt: nuevaFecha, status: nuevaFecha ? "SCHEDULED" : "DRAFT" },
  });
  await writeAudit({
    actorEmail: actor?.email ?? "automation",
    action: "CERT_OFFER_CAMPAIGN_RESCHEDULED",
    entityType: "CertificationOfferCampaign",
    entityId: campana.id,
    result: "SUCCESS",
    metadata: {
      courseId,
      before: campana.automaticScheduledAt?.toISOString() ?? null,
      after: nuevaFecha?.toISOString() ?? null,
    },
  });
  return actualizada;
}

/** Estado comercial de Finance para un conjunto de inscripciones, por lotes. */
async function consultarFinance(enrollmentIds: readonly string[]): Promise<Map<string, FinanceCommercialState> | null> {
  const mapa = new Map<string, FinanceCommercialState>();
  for (const lote of enLotes([...enrollmentIds], MAX_COMMERCE_BATCH)) {
    const resultado = await getCrmEnrollmentCommerceStates(lote)
      .catch(() => ({ ok: false as const, error: "Finance no respondió." }));
    // Fail closed: si un lote falla, no se decide nada con informacion parcial.
    if (!resultado.ok) return null;
    for (const [id, estado] of resultado.datos) mapa.set(id, estado.commercialState);
  }
  return mapa;
}

export async function excluir(campaignId: string, enrollmentIds: readonly string[], actor: { email: string }) {
  const resultado = await prisma.certificationOfferRecipient.updateMany({
    where: { campaignId, enrollmentId: { in: [...enrollmentIds] }, manualSentAt: null, automaticSentAt: null },
    data: { manualExcludedAt: new Date(), manualExcludedBy: actor.email, eligibilityStatus: "EXCLUDED" },
  });
  await writeAudit({
    actorEmail: actor.email,
    action: "CERT_OFFER_RECIPIENT_EXCLUDED",
    entityType: "CertificationOfferCampaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { cantidad: resultado.count },
  });
  return resultado.count;
}

export async function restaurar(campaignId: string, enrollmentIds: readonly string[], actor: { email: string }) {
  const resultado = await prisma.certificationOfferRecipient.updateMany({
    where: { campaignId, enrollmentId: { in: [...enrollmentIds] } },
    data: { manualExcludedAt: null, manualExcludedBy: null, exclusionReason: null, eligibilityStatus: "PENDING" },
  });
  await writeAudit({
    actorEmail: actor.email,
    action: "CERT_OFFER_RECIPIENT_RESTORED",
    entityType: "CertificationOfferCampaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { cantidad: resultado.count },
  });
  return resultado.count;
}

/** Marca la seleccion del administrador. En historico es la aprobacion. */
export async function seleccionar(campaignId: string, enrollmentIds: readonly string[], actor: { email: string }) {
  const resultado = await prisma.certificationOfferRecipient.updateMany({
    where: { campaignId, enrollmentId: { in: [...enrollmentIds] }, manualExcludedAt: null },
    data: { manuallyApprovedAt: new Date(), manuallyApprovedBy: actor.email },
  });
  await writeAudit({
    actorEmail: actor.email,
    action: "CERT_OFFER_RECIPIENT_SELECTED",
    entityType: "CertificationOfferCampaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { cantidad: resultado.count },
  });
  return resultado.count;
}

type ContextoEnvio = {
  campaignId: string;
  origen: "MANUAL" | "AUTOMATICO";
  enrollmentIds?: readonly string[];
  actorEmail: string;
};

/**
 * Encola la oferta para los destinatarios indicados.
 *
 * Se llama "encolar" y no "enviar" a proposito: aqui solo se crea el
 * OutboundMessage. Quien envia de verdad es el dispatcher existente, y el
 * estado del mensaje lo refleja. Marcar "enviado" al insertar la fila seria
 * afirmar algo que todavia no ocurrio.
 */
export async function encolarOferta(contexto: ContextoEnvio): Promise<ResultadoEnvio> {
  const campana = await prisma.certificationOfferCampaign.findUnique({
    where: { id: contexto.campaignId },
    include: { course: true },
  });
  if (!campana) throw new Error("CAMPAIGN_NOT_FOUND");

  // El cron jamas debe procesar una campaña historica: ahi decide una persona.
  if (contexto.origen === "AUTOMATICO" && campana.audienceMode !== "AUTOMATIC_COMMERCE") {
    return { encolados: 0, omitidos: 0, motivos: { CAMPANA_HISTORICA_NO_AUTOMATIZABLE: 1 } };
  }

  const urlOferta = campana.course.institutionalOfferUrl?.trim();
  if (!urlOferta) {
    // Fail closed: sin destino no se escribe a nadie.
    return { encolados: 0, omitidos: 0, motivos: { FALTA_URL_OFERTA: 1 } };
  }

  const destinatarios = await prisma.certificationOfferRecipient.findMany({
    where: {
      campaignId: campana.id,
      manualSentAt: null,
      automaticSentAt: null,
      manualExcludedAt: null,
      ...(contexto.enrollmentIds ? { enrollmentId: { in: [...contexto.enrollmentIds] } } : {}),
    },
    include: { enrollment: { include: { lead: true } } },
    take: 500,
  });

  const motivos: Record<string, number> = {};
  if (destinatarios.length === 0) return { encolados: 0, omitidos: 0, motivos };

  // Reconsulta a Finance JUSTO antes de escribir: entre cargar la pantalla y
  // pulsar enviar alguien puede haber comprado.
  const necesitaFinance = campana.audienceMode === "AUTOMATIC_COMMERCE";
  const estados = necesitaFinance
    ? await consultarFinance(destinatarios.map((destinatario) => destinatario.enrollmentId))
    : new Map<string, FinanceCommercialState>();

  if (necesitaFinance && estados === null) {
    await writeAudit({
      actorEmail: contexto.actorEmail,
      action: "CERT_OFFER_FINANCE_CHECK_FAILED",
      entityType: "CertificationOfferCampaign",
      entityId: campana.id,
      result: "FAILURE",
      metadata: { origen: contexto.origen, destinatarios: destinatarios.length },
    });
    return { encolados: 0, omitidos: destinatarios.length, motivos: { FINANCE_NO_DISPONIBLE: destinatarios.length } };
  }

  const secuencia = offerSequenceKey(campana.courseId);
  const simulacion = isChannelSimulation("WHATSAPP");
  let encolados = 0;
  let omitidos = 0;

  for (const destinatario of destinatarios) {
    const estadoFinance = estados?.get(destinatario.enrollmentId) ?? null;
    const decision = contexto.origen === "AUTOMATICO"
      ? decidirAutomatico(destinatario, estadoFinance)
      : decidirManual(destinatario, campana.audienceMode, estadoFinance);

    if (!decision.elegible) {
      omitidos++;
      sumar(motivos, decision.estado);
      await prisma.certificationOfferRecipient.update({
        where: { id: destinatario.id },
        data: {
          eligibilityStatus: decision.estado,
          exclusionReason: decision.motivo,
          commercialStateSnapshot: estadoFinance,
          lastEligibilityCheckAt: new Date(),
        },
      });
      continue;
    }

    const telefono = destinatario.enrollment.lead.phone;
    if (!telefono) {
      omitidos++;
      sumar(motivos, "SIN_TELEFONO");
      await prisma.certificationOfferRecipient.update({
        where: { id: destinatario.id },
        data: { eligibilityStatus: "ERROR", exclusionReason: "El contacto no tiene número de WhatsApp." },
      });
      continue;
    }

    const variables = {
      nombre: destinatario.enrollment.lead.firstName ?? destinatario.enrollment.lead.fullName.split(" ")[0] ?? destinatario.enrollment.lead.fullName,
      curso: campana.course.title,
      link_oferta_institucional: urlOferta,
    };
    const componentes = buildTemplateComponents(
      { name: PLANTILLA.name, language: PLANTILLA.language, bodyVars: [...PLANTILLA.bodyVars] },
      variables,
    );
    if (!componentes.ok) {
      omitidos++;
      sumar(motivos, componentes.errorCode);
      await prisma.certificationOfferRecipient.update({
        where: { id: destinatario.id },
        data: { eligibilityStatus: "ERROR", exclusionReason: componentes.error.slice(0, 300) },
      });
      continue;
    }

    try {
      // La unicidad de OutboundMessage es la barrera real contra duplicados.
      // Se intenta crear y se deja que choque: un `findFirst` previo no aguanta
      // dos peticiones simultaneas.
      const mensaje = await prisma.outboundMessage.create({
        data: {
          leadId: destinatario.enrollment.leadId,
          enrollmentId: destinatario.enrollmentId,
          channel: "WHATSAPP",
          toAddress: toWhatsAppRecipient(telefono),
          subject: null,
          body: `Oferta de certificación institucional · ${campana.course.title}`,
          status: "PROGRAMADO",
          scheduledAt: new Date(),
          sequenceKey: secuencia,
          stepKey: OFFER_STEP_KEY,
          isSimulation: simulacion,
          waTemplate: { name: PLANTILLA.name, language: PLANTILLA.language, components: componentes.components } as Prisma.InputJsonValue,
        },
      });
      await prisma.certificationOfferRecipient.update({
        where: { id: destinatario.id },
        data: {
          eligibilityStatus: "SENT",
          messageId: mensaje.id,
          commercialStateSnapshot: estadoFinance,
          lastEligibilityCheckAt: new Date(),
          ...(contexto.origen === "MANUAL" ? { manualSentAt: new Date() } : { automaticSentAt: new Date() }),
        },
      });
      encolados++;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Ya existia el mensaje: otra via lo encolo antes. No es un fallo.
        omitidos++;
        sumar(motivos, "YA_ENCOLADO");
        await prisma.certificationOfferRecipient.update({
          where: { id: destinatario.id },
          data: { eligibilityStatus: "SENT", ...(contexto.origen === "MANUAL" ? { manualSentAt: new Date() } : { automaticSentAt: new Date() }) },
        });
        continue;
      }
      throw error;
    }
  }

  await writeAudit({
    actorEmail: contexto.actorEmail,
    action: contexto.origen === "MANUAL" ? "CERT_OFFER_MANUAL_QUEUED" : "CERT_OFFER_AUTO_QUEUED",
    entityType: "CertificationOfferCampaign",
    entityId: campana.id,
    result: "SUCCESS",
    metadata: { encolados, omitidos, motivos },
  });
  return { encolados, omitidos, motivos };
}

/**
 * Campañas automaticas vencidas que el reloj debe procesar.
 *
 * Filtra por modo en la propia consulta: una campaña historica no puede llegar
 * al cron ni aunque tuviera fecha por error.
 */
export async function procesarCampanasVencidas(ahora = new Date()) {
  const vencidas = await prisma.certificationOfferCampaign.findMany({
    where: {
      audienceMode: "AUTOMATIC_COMMERCE",
      status: { in: ["SCHEDULED", "RUNNING"] },
      automaticScheduledAt: { lte: ahora },
    },
    select: { id: true },
    take: 5,
  });

  let campanas = 0;
  let encolados = 0;
  for (const campana of vencidas) {
    // Claim: solo un proceso pasa de SCHEDULED a RUNNING. Dos crones
    // simultaneos no procesan la misma campaña.
    const reclamada = await prisma.certificationOfferCampaign.updateMany({
      where: { id: campana.id, status: "SCHEDULED" },
      data: { status: "RUNNING", automaticExecutedAt: ahora },
    });
    if (reclamada.count !== 1) continue;
    const resultado = await encolarOferta({ campaignId: campana.id, origen: "AUTOMATICO", actorEmail: "automation" });
    encolados += resultado.encolados;
    campanas++;
    await prisma.certificationOfferCampaign.update({ where: { id: campana.id }, data: { status: "COMPLETED" } });
  }
  return { campanas, encolados };
}
