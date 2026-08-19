import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { FINANCE_HANDOFF_ROLES } from "@/lib/finance/authorization";
import { confirmEnrollmentWithFinance } from "@/lib/finance/handoff";

const requestSchema = z.object({ confirm: z.literal(true) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, FINANCE_HANDOFF_ROLES);
  if (auth.error) return auth.error;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Debes confirmar el envío a Finance." }, { status: 422 });
  }
  const { id } = await params;
  try {
    return NextResponse.json(await confirmEnrollmentWithFinance(id, auth.session));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ENROLLMENT_NOT_FOUND") {
      return NextResponse.json({ error: "No se encontró la inscripción." }, { status: 404 });
    }
    if (code === "ENROLLMENT_NOT_ELIGIBLE") {
      return NextResponse.json({ error: "Esta inscripción no puede vincularse con Finance." }, { status: 409 });
    }
    if (code === "HANDOFF_IN_PROGRESS") {
      return NextResponse.json({ error: "El envío a Finance ya está en proceso." }, { status: 409 });
    }
    if (code === "FINANCE_COURSE_MODALITY_MISSING") {
      return NextResponse.json({ error: "Configura la modalidad del curso antes de enviarlo a Finance." }, { status: 422 });
    }
    if (code === "FINANCE_COURSE_DATES_MISSING") {
      return NextResponse.json({ error: "Configura las fechas del curso antes de enviarlo a Finance." }, { status: 422 });
    }
    if (code === "FINANCE_NOT_AVAILABLE") {
      return NextResponse.json({ error: "Finance no está disponible en este momento." }, { status: 503 });
    }
    if (code === "FINANCE_SERVICE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "Este curso no está configurado como un servicio activo en Finance." }, { status: 422 });
    }
    if (code === "FINANCE_AUTH_FAILED") {
      return NextResponse.json({ error: "Finance no está disponible en este momento." }, { status: 503 });
    }
    return NextResponse.json({ error: "No se pudo enviar la inscripción a Finance." }, { status: 502 });
  }
}
