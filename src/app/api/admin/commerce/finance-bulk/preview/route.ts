import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { FINANCE_HANDOFF_ROLES } from "@/lib/finance/authorization";
import { previewBulkFinanceHandoff } from "@/lib/finance/bulk-handoff";

export const dynamic = "force-dynamic";

const schema = z.object({ courseId: z.string().trim().min(1) });

/**
 * Vista previa de "Enviar curso a Finance" (sección T del release de
 * estabilización). Solo lee: nada se envía a Finance en esta llamada.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, FINANCE_HANDOFF_ROLES);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Selecciona un curso." }, { status: 422 });

  try {
    const preview = await previewBulkFinanceHandoff(parsed.data.courseId);
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    if (error instanceof Error && error.message === "COURSE_NOT_FOUND") {
      return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });
    }
    return NextResponse.json({ error: "No se pudo preparar la vista previa." }, { status: 502 });
  }
}
