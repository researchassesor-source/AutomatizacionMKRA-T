import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { reprogramarOfertaAutomatica } from "@/lib/commerce/offer-campaign";
import { isTrustedOfficialCourseUrl } from "@/lib/course-validation";

export const dynamic = "force-dynamic";

const schema = z.object({
  institutionalOfferUrl: z.union([z.literal(""), z.string().trim().refine(isTrustedOfficialCourseUrl, "La URL de la oferta debe pertenecer a ra-training.com.")]).optional(),
  institutionalOfferPrice: z.union([z.literal(""), z.coerce.number().min(0).max(100_000)]).optional(),
  institutionalOfferDelayHours: z.coerce.number().int().min(0).max(720).optional(),
  confirm: z.literal(true),
});

/**
 * Datos de la oferta institucional #12 (sección N del release de
 * estabilización): URL, precio y horas posteriores al calendario.
 *
 * Endpoint propio, no el PATCH general del curso: esos tres campos hasta
 * ahora no tenían NINGÚN formulario que los editara (solo existían en el
 * esquema de validación); esta es la primera superficie real para
 * configurarlos, desde la fila "Oferta institucional" de DATOS PARA LOS
 * MENSAJES.
 *
 * Cambiar las horas posteriores puede mover cuándo se envía la oferta
 * automática, así que se recalcula justo después de guardar -- la misma
 * función que ya usa schedule-proposal cuando cambia el calendario.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });

  const { id } = await params;
  const current = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!current) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const data: Record<string, string | number | null> = {};
  if (parsed.data.institutionalOfferUrl !== undefined) data.institutionalOfferUrl = parsed.data.institutionalOfferUrl || null;
  if (parsed.data.institutionalOfferPrice !== undefined) data.institutionalOfferPrice = parsed.data.institutionalOfferPrice === "" ? null : parsed.data.institutionalOfferPrice;
  if (parsed.data.institutionalOfferDelayHours !== undefined) data.institutionalOfferDelayHours = parsed.data.institutionalOfferDelayHours;
  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true, changed: false });

  await prisma.course.update({ where: { id }, data });
  await writeAudit({ session: auth.session, action: "COURSE_INSTITUTIONAL_OFFER_UPDATED", entityType: "Course", entityId: id, metadata: { campos: Object.keys(data) } });

  const reprogramada = await reprogramarOfertaAutomatica(id, auth.session).catch(() => undefined);

  return NextResponse.json({ ok: true, changed: true, reprogramada: Boolean(reprogramada) });
}
