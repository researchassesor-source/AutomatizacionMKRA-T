import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { FINANCE_HANDOFF_ROLES } from "@/lib/finance/authorization";

export const dynamic = "force-dynamic";

const schema = z.object({ financeServiceId: z.string().trim().min(1).max(120).nullable(), confirm: z.literal(true) });

/**
 * Vínculo estable de UN curso con un Servicio de Finance (sección R del
 * release de estabilización).
 *
 * Endpoint propio y no el PATCH general del curso: ese exige el payload
 * completo (título, slug, precios...), y esta decisión -a qué Servicio de
 * Finance corresponde este curso- la toma una persona distinta, en un
 * momento distinto, mirando solo esto.
 *
 * No se revalida aquí que el ID siga activo en Finance: el selector que lo
 * ofrece ya solo lista servicios activos, y si de todos modos quedara
 * apuntando a uno inactivo o borrado, el traspaso a Finance falla cerrado en
 * ese momento (resolverServicioPorIdImportacionCrm, sin caer al nombre) en
 * vez de aquí.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, FINANCE_HANDOFF_ROLES);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });

  const { id } = await params;
  const current = await prisma.course.findUnique({ where: { id }, select: { id: true, title: true, financeServiceId: true } });
  if (!current) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const updated = await prisma.course.update({ where: { id }, data: { financeServiceId: parsed.data.financeServiceId } });
  await writeAudit({
    session: auth.session,
    action: "COURSE_FINANCE_SERVICE_LINKED",
    entityType: "Course",
    entityId: id,
    metadata: { curso: current.title, antes: current.financeServiceId, despues: updated.financeServiceId },
  });

  return NextResponse.json({ ok: true, financeServiceId: updated.financeServiceId });
}
