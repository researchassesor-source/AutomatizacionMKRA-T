import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { OPERACION } from "@/lib/auth/roles";
import { construirTimeline, MAX_EVENTOS } from "@/lib/timeline/lead-timeline";

export const dynamic = "force-dynamic";

const schema = z.object({
  category: z.enum(["ALL", "MESSAGES", "COMMERCE", "AUTOMATION", "SYSTEM"]).default("ALL"),
  limit: z.coerce.number().int().min(1).max(MAX_EVENTOS).default(30),
  before: z.string().datetime().optional(),
});

/**
 * Actividad de un contacto.
 *
 * Solo lectura y siempre acotada. El identificador del contacto viene de la
 * ruta y se consulta tal cual: no hay forma de pedir la actividad de otro sin
 * tener permiso para verlo, porque el rol se comprueba antes.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, OPERACION);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Parámetros no válidos." }, { status: 422 });

  const { id } = await params;
  const resultado = await construirTimeline(id, parsed.data);
  if (!resultado) return NextResponse.json({ error: "No se encontró el contacto." }, { status: 404 });

  return NextResponse.json({ ok: true, ...resultado });
}
