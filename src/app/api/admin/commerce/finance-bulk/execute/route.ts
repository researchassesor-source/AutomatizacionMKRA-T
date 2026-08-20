import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { FINANCE_HANDOFF_ROLES } from "@/lib/finance/authorization";
import { writeAudit } from "@/lib/audit";
import { executeBulkFinanceHandoff } from "@/lib/finance/bulk-handoff";

export const dynamic = "force-dynamic";

const schema = z.object({ courseId: z.string().trim().min(1), confirm: z.literal("SEND_COURSE_TO_FINANCE") });

/**
 * Ejecuta "Enviar curso a Finance" (sección T). Procesa en el servidor, no
 * en un bucle de fetch desde el navegador: ver executeBulkFinanceHandoff.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, FINANCE_HANDOFF_ROLES);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Debes confirmar el envío masivo a Finance." }, { status: 422 });

  try {
    const resultado = await executeBulkFinanceHandoff(parsed.data.courseId, auth.session);
    await writeAudit({
      session: auth.session,
      action: "FINANCE_BULK_HANDOFF",
      entityType: "Course",
      entityId: parsed.data.courseId,
      result: resultado.fallaGlobal ? "FAILURE" : "SUCCESS",
      metadata: { total: resultado.total, enviados: resultado.enviados, fallidos: resultado.fallidos, fallaGlobal: resultado.fallaGlobal },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    if (error instanceof Error && error.message === "COURSE_NOT_FOUND") {
      return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });
    }
    return NextResponse.json({ error: "No se pudo completar el envío masivo." }, { status: 502 });
  }
}
