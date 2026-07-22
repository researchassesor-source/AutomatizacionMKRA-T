import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { captureLead, leadInputSchema } from "@/lib/leads";

// Evita que Next intente pre-renderizar/cachear esta ruta.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  try {
    const input = leadInputSchema.parse(body);
    const lead = await captureLead(input);
    return NextResponse.json({ ok: true, leadId: lead.id }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? "Datos invalidos" },
        { status: 422 },
      );
    }
    console.error("[leads] error", err);
    return NextResponse.json(
      { error: "No pudimos registrar tu inscripcion. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
