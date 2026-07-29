import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { completeEnrollment } from "@/lib/finance/handoff";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  const parsed = z.object({ confirm: z.literal(true) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Debes confirmar la finalización y el envío." }, { status: 422 });
  const { id } = await params;
  try {
    return NextResponse.json(await completeEnrollment(id, "ADMIN", auth.session));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ENROLLMENT_NOT_FOUND") {
      return NextResponse.json({ error: "No se encontró la inscripción." }, { status: 404 });
    }
    if (message === "ENROLLMENT_NOT_COMPLETED") {
      return NextResponse.json({ error: "La inscripción aún no está completada." }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo conectar con Finance." }, { status: 502 });
  }
}
