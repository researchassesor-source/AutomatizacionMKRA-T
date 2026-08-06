import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { courseSessionData, courseSessionSchema } from "@/lib/course-session-validation";
import { prisma } from "@/lib/db";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = courseSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id, sessionId } = await params;
  const current = await prisma.courseSession.findUnique({ where: { id: sessionId }, select: { courseId: true } });
  if (!current || current.courseId !== id) return NextResponse.json({ error: "No se encontró la sesión." }, { status: 404 });

  const session = await prisma.courseSession.update({ where: { id: sessionId }, data: courseSessionData(parsed.data) });
  await writeAudit({ session: auth.session, action: "COURSE_SESSION_UPDATED", entityType: "CourseSession", entityId: sessionId, metadata: { courseId: id, startAt: session.startAt.toISOString(), streamUrlConfigured: Boolean(session.streamUrl) } });
  const rescheduled = await rescheduleCourseAutomations(id);
  return NextResponse.json({ ok: true, session, rescheduled });
}

/**
 * Eliminar una sesion cancela sus recordatorios pendientes. El historial de los
 * mensajes ya enviados se conserva: la relacion queda en null, no se borra.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const confirmation = z.object({ confirm: z.literal(true) }).safeParse(await request.json().catch(() => null));
  if (!confirmation.success) return NextResponse.json({ error: "Debes confirmar la eliminación de la sesión." }, { status: 422 });
  const { id, sessionId } = await params;
  const current = await prisma.courseSession.findUnique({ where: { id: sessionId }, select: { courseId: true, startAt: true } });
  if (!current || current.courseId !== id) return NextResponse.json({ error: "No se encontró la sesión." }, { status: 404 });

  const sentMessages = await prisma.outboundMessage.count({
    where: { courseSessionId: sessionId, status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO", "SIMULADO"] } },
  });
  await prisma.courseSession.delete({ where: { id: sessionId } });
  await writeAudit({
    session: auth.session,
    action: "COURSE_SESSION_DELETED",
    entityType: "CourseSession",
    entityId: sessionId,
    metadata: { courseId: id, startAt: current.startAt.toISOString(), preservedMessages: sentMessages },
  });
  const rescheduled = await rescheduleCourseAutomations(id);
  return NextResponse.json({ ok: true, preservedMessages: sentMessages, rescheduled });
}
