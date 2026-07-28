import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { captureLead, hasPlausibleFormTiming, leadInputSchema } from "@/lib/leads";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { PayloadTooLargeError, readJsonBody } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = checkRateLimit(requestKey(request, "lead-capture"), {
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Se recibieron demasiados intentos. Espera unos minutos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const input = leadInputSchema.parse(await readJsonBody(request, 16_384));
    if (input.website || !hasPlausibleFormTiming(input.formStartedAt)) {
      return NextResponse.json({ error: "No se pudo validar el formulario." }, { status: 422 });
    }
    const result = await captureLead(input);
    return NextResponse.json(
      {
        ok: true,
        leadId: result.lead.id,
        enrollmentId: result.enrollment.id,
        redirectUrl: result.redirectUrl,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? "Datos no válidos." },
        { status: 422 },
      );
    }
    if (error instanceof Error && error.message === "COURSE_NOT_FOUND") {
      return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });
    }
    console.error("[leads] No se pudo registrar el contacto.");
    return NextResponse.json(
      { error: "No se pudo guardar el contacto." },
      { status: 500 },
    );
  }
}
