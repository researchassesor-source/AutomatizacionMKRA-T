import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { asegurarCampana, encolarOferta, excluir, restaurar, seleccionar, sincronizarDestinatarios } from "@/lib/commerce/offer-campaign";
import { advertenciaComercial } from "@/lib/commerce/offer-eligibility";

export const dynamic = "force-dynamic";

/**
 * Campaña de oferta de certificacion institucional.
 *
 * GET  -> estado de la campaña de un curso y sus destinatarios.
 * POST -> acciones del administrador sobre esa campaña.
 *
 * Todas las acciones que escriben validan que los inscritos indicados
 * pertenezcan a ESE curso: un identificador de otra campaña no puede colarse
 * por el cuerpo de la peticion y provocar un envio fuera de audiencia.
 */

const accionSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("crear"), courseId: z.string().min(1), audienceMode: z.enum(["HISTORICAL_MANUAL", "AUTOMATIC_COMMERCE"]) }),
  z.object({ accion: z.literal("sincronizar"), campaignId: z.string().min(1) }),
  z.object({ accion: z.literal("seleccionar"), campaignId: z.string().min(1), enrollmentIds: z.array(z.string().min(1)).min(1).max(500) }),
  z.object({ accion: z.literal("excluir"), campaignId: z.string().min(1), enrollmentIds: z.array(z.string().min(1)).min(1).max(500) }),
  z.object({ accion: z.literal("restaurar"), campaignId: z.string().min(1), enrollmentIds: z.array(z.string().min(1)).min(1).max(500) }),
  z.object({ accion: z.literal("enviar"), campaignId: z.string().min(1), enrollmentIds: z.array(z.string().min(1)).min(1).max(500), confirm: z.literal(true) }),
]);

export async function GET(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;

  const courseId = new URL(request.url).searchParams.get("courseId")?.trim();
  if (!courseId) return NextResponse.json({ error: "Indica el curso." }, { status: 422 });

  const campana = await prisma.certificationOfferCampaign.findUnique({
    where: { courseId },
    include: {
      course: { select: { title: true, institutionalOfferUrl: true, institutionalOfferPrice: true, institutionalOfferDelayHours: true } },
      recipients: {
        include: { enrollment: { include: { lead: { select: { fullName: true, phone: true } } } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!campana) return NextResponse.json({ ok: true, campana: null });

  const destinatarios = campana.recipients.map((destinatario) => ({
    enrollmentId: destinatario.enrollmentId,
    nombre: destinatario.enrollment.lead.fullName,
    telefono: destinatario.enrollment.lead.phone,
    estado: destinatario.eligibilityStatus,
    estadoComercial: destinatario.commercialStateSnapshot,
    // En modo historico esto se muestra pero NO decide: la lista real la tiene
    // el administrador.
    advertencia: advertenciaComercial(destinatario.commercialStateSnapshot),
    seleccionado: Boolean(destinatario.manuallyApprovedAt),
    excluido: Boolean(destinatario.manualExcludedAt),
    enviadoManual: destinatario.manualSentAt?.toISOString() ?? null,
    enviadoAutomatico: destinatario.automaticSentAt?.toISOString() ?? null,
    motivo: destinatario.exclusionReason,
  }));

  return NextResponse.json({
    ok: true,
    campana: {
      id: campana.id,
      audienceMode: campana.audienceMode,
      status: campana.status,
      automaticScheduledAt: campana.automaticScheduledAt?.toISOString() ?? null,
      automaticExecutedAt: campana.automaticExecutedAt?.toISOString() ?? null,
      curso: campana.course.title,
      urlOferta: campana.course.institutionalOfferUrl,
      precio: campana.course.institutionalOfferPrice ? Number(campana.course.institutionalOfferPrice) : null,
      delayHoras: campana.course.institutionalOfferDelayHours,
    },
    destinatarios,
    contadores: {
      participantes: destinatarios.length,
      seleccionados: destinatarios.filter((d) => d.seleccionado && !d.excluido && !d.enviadoManual && !d.enviadoAutomatico).length,
      enviadosManualmente: destinatarios.filter((d) => d.enviadoManual).length,
      enviadosAutomaticamente: destinatarios.filter((d) => d.enviadoAutomatico).length,
      pendientes: destinatarios.filter((d) => !d.enviadoManual && !d.enviadoAutomatico && !d.excluido).length,
      excluidos: destinatarios.filter((d) => d.excluido).length,
      requierenRevision: destinatarios.filter((d) => d.estado === "REQUIRES_REVIEW").length,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  // `requireRole` devuelve la sesion aparte del error; sin esta comprobacion
  // TypeScript no puede saber que aqui ya existe.
  if (!auth.session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const parsed = accionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }
  const datos = parsed.data;
  const actor = { email: auth.session.email };

  if (datos.accion === "crear") {
    const campana = await asegurarCampana(datos.courseId, datos.audienceMode, actor);
    const sincronizados = await sincronizarDestinatarios(campana.id);
    return NextResponse.json({ ok: true, campaignId: campana.id, ...sincronizados });
  }

  const campana = await prisma.certificationOfferCampaign.findUnique({ where: { id: datos.campaignId } });
  if (!campana) return NextResponse.json({ error: "La campaña no existe." }, { status: 404 });

  if (datos.accion === "sincronizar") {
    return NextResponse.json({ ok: true, ...(await sincronizarDestinatarios(campana.id)) });
  }

  /**
   * Los inscritos indicados tienen que pertenecer a ESTA campaña.
   *
   * Sin esta comprobacion, un identificador de otro curso enviado en el cuerpo
   * de la peticion haria que alguien recibiera una oferta que no le
   * corresponde, y el filtro por `campaignId` de las consultas posteriores lo
   * ocultaria en silencio en vez de rechazarlo.
   */
  const pertenecen = await prisma.certificationOfferRecipient.count({
    where: { campaignId: campana.id, enrollmentId: { in: datos.enrollmentIds } },
  });
  if (pertenecen !== datos.enrollmentIds.length) {
    return NextResponse.json({ error: "Algunos participantes no pertenecen a esta campaña." }, { status: 422 });
  }

  if (datos.accion === "seleccionar") {
    return NextResponse.json({ ok: true, seleccionados: await seleccionar(campana.id, datos.enrollmentIds, actor) });
  }
  if (datos.accion === "excluir") {
    return NextResponse.json({ ok: true, excluidos: await excluir(campana.id, datos.enrollmentIds, actor) });
  }
  if (datos.accion === "restaurar") {
    return NextResponse.json({ ok: true, restaurados: await restaurar(campana.id, datos.enrollmentIds, actor) });
  }

  const resultado = await encolarOferta({
    campaignId: campana.id,
    origen: "MANUAL",
    enrollmentIds: datos.enrollmentIds,
    actorEmail: auth.session.email,
  });
  // Se llama "encolados" y no "enviados": el envio real lo hace el dispatcher.
  return NextResponse.json({ ok: true, ...resultado });
}
