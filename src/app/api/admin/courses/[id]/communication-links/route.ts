import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/** Vacio significa "sin configurar", no una cadena vacia guardada. */
const enlace = z.union([z.string().trim().url().max(500), z.literal(""), z.null()]).optional();

const schema = z.object({
  whatsappGroupUrl: enlace,
  courseCompleteUrl: enlace,
  surveyUrl: enlace,
}).refine((v) => Object.keys(v).length > 0, { message: "No hay nada que cambiar." });

/**
 * Los tres enlaces que usan los mensajes del recorrido.
 *
 * Endpoint propio y no el PATCH general del curso: obligar al panel a reenviar
 * el curso entero para cambiar una URL significa que un campo que nadie toco
 * puede viajar mal y sobrescribir precio, fechas o publicacion.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Revisa las direcciones.", errorCode: "LINK_INVALID" }, { status: 422 });
  }

  const { id } = await params;
  const curso = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!curso) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const data: Record<string, string | null> = {};
  for (const campo of ["whatsappGroupUrl", "courseCompleteUrl", "surveyUrl"] as const) {
    const valor = parsed.data[campo];
    if (valor === undefined) continue;
    data[campo] = valor === "" || valor === null ? null : valor;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true, changed: false });

  // Solo estos tres campos: nada de precio, publicacion ni fechas.
  await prisma.course.update({ where: { id }, data });

  await writeAudit({
    session: auth.session,
    action: "COURSE_COMMUNICATION_LINKS_UPDATED",
    entityType: "Course",
    entityId: id,
    metadata: { campos: Object.keys(data), configurados: Object.values(data).filter(Boolean).length },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, changed: true });
}
