import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { courseSessionData, courseSessionSchema } from "@/lib/course-session-validation";
import { prisma } from "@/lib/db";
import { markCourseAutomationReconcilePending, reconcileCourseDerivedState } from "@/lib/nurture/course-reconciliation";
import { cancelIrreversibleMessages, quarantineCourseCalendarDependentMessages } from "@/lib/nurture/queue-safety";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Cambiar fecha/enlace de una sesión ya programada.
 *
 * Cuarentena ANTES de guardar, en la misma transacción: el cuerpo de cada
 * mensaje se renderiza al programarlo, no al enviarlo, así que sin esto un
 * envío que cayera justo entre guardar la sesión y el recálculo saldría con
 * la fecha o el enlace VIEJOS ya congelados en el texto.
 *
 * El alcance es el CURSO entero, no solo `courseSessionId: sessionId`: mover
 * la fecha de esta sesión puede reordenarla frente a sus hermanas
 * (`resolveCourseSessions` asigna "sesión X de Y" por orden cronológico de
 * TODAS las sesiones), así que un mensaje de una sesión que nadie tocó
 * directamente puede quedar describiendo el orden equivocado si no se
 * recalcula también.
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
    quarantined = await quarantineCourseCalendarDependentMessages(
      tx,
      id,
      { errorCode: "SCHEDULE_RECONCILING", errorMessage: "El calendario cambió y este aviso está esperando ser recalculado." },
    );
    const actualizada = await tx.courseSession.update({ where: { id: sessionId }, data: courseSessionData(parsed.data) });
    await markCourseAutomationReconcilePending(tx, id, "SESSION_UPDATED");
    return actualizada;
  });

  await writeAudit({ session: auth.session, action: "COURSE_SESSION_UPDATED", entityType: "CourseSession", entityId: sessionId, metadata: { courseId: id, startAt: session.startAt.toISOString(), streamUrlConfigured: Boolean(session.streamUrl), quarantined } });
  const reconciled = await reconcileCourseDerivedState(id, auth.session);
  return NextResponse.json({ ok: true, session, quarantined, pending: !reconciled.ok, reconciled });
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
 *
 * Además de cancelar los mensajes de LA SESIÓN eliminada, se pone en
 * cuarentena (recuperable, no cancelada) todo lo demás que depende del
 * calendario del curso: quitar una sesión desplaza `totalSessions` para las
 * que quedan -3 sesiones a 2 convierte "sesión 2 de 3" en "sesión 1 de 2"-,
 * aunque su propia fecha nunca haya cambiado.
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
  let quarantined = 0;
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
    quarantined = await quarantineCourseCalendarDependentMessages(
      tx,
      id,
      { errorCode: "SCHEDULE_RECONCILING", errorMessage: "El calendario cambió y este aviso está esperando ser recalculado." },
    );
    await markCourseAutomationReconcilePending(tx, id, "SESSION_DELETED");
  });
  await writeAudit({
    session: auth.session,
    action: "COURSE_SESSION_DELETED",
    entityType: "CourseSession",
    entityId: sessionId,
    metadata: { courseId: id, startAt: current.startAt.toISOString(), preservedMessages, cancelled, quarantined },
  });
  const reconciled = await reconcileCourseDerivedState(id, auth.session);
  return NextResponse.json({ ok: true, preservedMessages, cancelled, quarantined, pending: !reconciled.ok, reconciled });
}
