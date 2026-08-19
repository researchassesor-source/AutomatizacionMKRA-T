import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";
import { quarantineRecoverableMessages } from "@/lib/nurture/queue-safety";

export const dynamic = "force-dynamic";

/**
 * Qué momentos dependen de cada enlace, para poner en cuarentena solo lo que
 * de verdad va a cambiar de contenido.
 *
 * `course_follow_up` acompaña a `course_complete`: es el seguimiento DE esa
 * oferta, y si el mensaje que la presenta queda bloqueado por falta de
 * enlace, el seguimiento hablaría de algo que la persona nunca recibió (ver
 * el mismo criterio en engine.ts, junto al gate MISSING_COURSE_COMPLETE_URL).
 */
const PLAN_KEYS_POR_ENLACE: Record<"whatsappGroupUrl" | "courseCompleteUrl" | "surveyUrl", string[]> = {
  whatsappGroupUrl: ["whatsapp_group"],
  courseCompleteUrl: ["course_complete", "course_follow_up"],
  surveyUrl: ["survey"],
};

/** Vacio significa "sin configurar", no una cadena vacia guardada. */
const enlace = z.union([z.string().trim().url().max(500), z.literal(""), z.null()]).optional();

const schema = z.object({
  whatsappGroupUrl: enlace,
  courseCompleteUrl: enlace,
  surveyUrl: enlace,
  confirm: z.literal(true),
}).refine(
  (v) => v.whatsappGroupUrl !== undefined || v.courseCompleteUrl !== undefined || v.surveyUrl !== undefined,
  { message: "No hay nada que cambiar." },
);

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

  /**
   * Cuarentena ANTES de guardar, en la misma transacción que el cambio.
   *
   * El cuerpo de cada mensaje se renderiza y se guarda al PROGRAMARLO, no al
   * enviarlo: sin esto, un envío que cayera justo entre guardar el enlace
   * nuevo y que rescheduleCourseAutomations recalculara el cuerpo saldría con
   * el enlace VIEJO ya congelado en el texto. Poner esos mensajes en OMITIDO
   * primero cierra esa ventana: si salen, salen recalculados.
   */
  const planKeysAfectados = Object.keys(data).flatMap((campo) => PLAN_KEYS_POR_ENLACE[campo as keyof typeof PLAN_KEYS_POR_ENLACE]);
  let quarantined = 0;
  await prisma.$transaction(async (tx) => {
    if (planKeysAfectados.length > 0) {
      quarantined = await quarantineRecoverableMessages(
        tx,
        { enrollment: { courseId: id }, automationRule: { planKey: { in: planKeysAfectados } } },
        { errorCode: "COMMUNICATION_LINK_CHANGING", errorMessage: "Este aviso se recalcula porque el enlace del curso cambió." },
      );
    }
    // Solo estos tres campos: nada de precio, publicacion ni fechas.
    await tx.course.update({ where: { id }, data });
  });

  await writeAudit({
    session: auth.session,
    action: "COURSE_COMMUNICATION_LINKS_UPDATED",
    entityType: "Course",
    entityId: id,
    metadata: { campos: Object.keys(data), configurados: Object.values(data).filter(Boolean).length, quarantined },
  }).catch(() => undefined);

  // Recupera lo que estaba OMITIDO por falta de enlace (si se acaba de
  // configurar) y recalcula lo que se puso en cuarentena arriba. Nunca envía
  // tarde: rescheduleCourseAutomations omite de nuevo lo que ya pasó de hora.
  const rescheduled = await rescheduleCourseAutomations(id).catch(() => null);

  return NextResponse.json({ ok: true, changed: true, quarantined, rescheduled });
}
