import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { courseSessionData, courseSessionSchema } from "@/lib/course-session-validation";
import { prisma } from "@/lib/db";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";
import { cancelIrreversibleMessages, quarantineRecoverableMessages } from "@/lib/nurture/queue-safety";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Cambiar fecha/enlace de una sesión ya programada.
 *
 * Cuarentena ANTES de guardar, en la misma transacción: el cuerpo de cada
 * mensaje se renderiza al programarlo, no al enviarlo, así que sin esto un
 * envío que cayera justo entre guardar la sesión y que
 * rescheduleCourseAutomations recalculara el cuerpo saldría con la fecha o el
 * enlace VIEJOS ya congelados en el texto.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = courseSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id, sessionId } = await params;
  const current = await prisma.courseSession.findUnique({ where: { id: sessionId }, select: { courseId: true } });
  if (!current || current.courseId !== id) return NextResponse.json({ error: "No se encontró la sesión." }, { status: 404 });

  let quarantined = 0;
  const session = await prisma.$transaction(async (tx) => {
    quarantined = await quarantineRecoverableMessages(
      tx,
      { courseSessionId: sessionId },
      { errorCode: "SCHEDULE_RECONCILING", errorMessage: "El calendario cambió y este aviso está esperando ser recalculado." },
    );
    return tx.courseSession.update({ where: { id: sessionId }, data: courseSessionData(parsed.data) });
  });

  await writeAudit({ session: auth.session, action: "COURSE_SESSION_UPDATED", entityType: "CourseSession", entityId: sessionId, metadata: { courseId: id, startAt: session.startAt.toISOString(), streamUrlConfigured: Boolean(session.streamUrl), quarantined } });
  const rescheduled = await rescheduleCourseAutomations(id).catch(() => null);
  return NextResponse.json({ ok: true, session, quarantined, rescheduled });
}

/**
 * Eliminar una sesion cancela DEFINITIVAMENTE sus recordatorios pendientes,
 * ANTES de borrarla, en la misma transacción.
 *
 * `OutboundMessage.courseSession` tiene `onDelete: SetNull`: borrar la fila
 * primero dejaría un PROGRAMADO con `courseSessionId = null` que
 * rescheduleCourseAutomations nunca vuelve a tocar (recalcula a partir del
 * calendario ACTUAL, que ya no incluye esta sesión, así que ese mensaje
 * huérfano no corresponde a ningún target nuevo y se queda tal cual para
 * siempre). Cancelar antes de borrar es lo único que lo evita. El historial
 * de lo ya enviado sí se conserva con la relación en null: eso es narrativa
 * pasada, no cola.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const confirmation = z.object({ confirm: z.literal(true) }).safeParse(await request.json().catch(() => null));
  if (!confirmation.success) return NextResponse.json({ error: "Debes confirmar la eliminación de la sesión." }, { status: 422 });
  const { id, sessionId } = await params;
  const current = await prisma.courseSession.findUnique({ where: { id: sessionId }, select: { courseId: true, startAt: true } });
  if (!current || current.courseId !== id) return NextResponse.json({ error: "No se encontró la sesión." }, { status: 404 });

  let cancelled = 0;
  let preservedMessages = 0;
  await prisma.$transaction(async (tx) => {
    preservedMessages = await tx.outboundMessage.count({
      where: { courseSessionId: sessionId, status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO", "SIMULADO"] } },
    });
    cancelled = await cancelIrreversibleMessages(
      tx,
      { courseSessionId: sessionId },
      { errorCode: "SESSION_REMOVED", errorMessage: "La sesión asociada dejó de existir." },
    );
    await tx.courseSession.delete({ where: { id: sessionId } });
  });
  await writeAudit({
    session: auth.session,
    action: "COURSE_SESSION_DELETED",
    entityType: "CourseSession",
    entityId: sessionId,
    metadata: { courseId: id, startAt: current.startAt.toISOString(), preservedMessages, cancelled },
  });
  const rescheduled = await rescheduleCourseAutomations(id).catch(() => null);
  return NextResponse.json({ ok: true, preservedMessages, cancelled, rescheduled });
}
