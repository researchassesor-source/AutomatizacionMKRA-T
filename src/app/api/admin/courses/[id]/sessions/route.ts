import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { courseSessionData, courseSessionSchema, courseStreamUrlSchema } from "@/lib/course-session-validation";
import { prisma } from "@/lib/db";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";
import { quarantineRecoverableMessages } from "@/lib/nurture/queue-safety";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Crea una sesion del curso y recalcula los recordatorios pendientes.
 *
 * Una sesión nueva no puede tener mensajes previos que proteger (no existía),
 * así que no hace falta cuarentena aquí: solo que un fallo del recálculo
 * posterior no oculte que la sesión SÍ se creó.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = courseSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const session = await prisma.courseSession.create({ data: { courseId: id, ...courseSessionData(parsed.data) } });
  await writeAudit({ session: auth.session, action: "COURSE_SESSION_CREATED", entityType: "CourseSession", entityId: session.id, metadata: { courseId: id, startAt: session.startAt.toISOString(), streamUrlConfigured: Boolean(session.streamUrl) } });
  // La sesión ya está creada a partir de aquí: un fallo del recálculo nunca
  // puede parecer que la creación entera no ocurrió.
  const rescheduled = await rescheduleCourseAutomations(id).catch(() => null);
  return NextResponse.json({
    ok: true,
    session,
    rescheduled,
    ...(rescheduled === null ? { warning: "La sesión se creó, pero el recálculo de recordatorios quedó pendiente. Vuelve a intentarlo." } : {}),
  }, { status: 201 });
}

/**
 * Actualiza el enlace de transmision por defecto del curso.
 *
 * Es el mismo riesgo que el enlace de una sesión individual: las reglas con
 * `requiresStreamUrl` usan `session.streamUrl ?? course.streamUrl` como
 * enlace efectivo (ver resolveCourseSessions), así que cambiar el de aquí
 * también puede dejar un cuerpo ya renderizado con el enlace viejo si un
 * envío cae justo en la ventana antes del recálculo.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = courseStreamUrlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  let quarantined = 0;
  await prisma.$transaction(async (tx) => {
    quarantined = await quarantineRecoverableMessages(
      tx,
      { enrollment: { courseId: id }, automationRule: { requiresStreamUrl: true } },
      { errorCode: "SCHEDULE_RECONCILING", errorMessage: "El enlace de transmisión cambió y este aviso está esperando ser recalculado." },
    );
    await tx.course.update({ where: { id }, data: { streamUrl: parsed.data.streamUrl || null } });
  });
  await writeAudit({ session: auth.session, action: "COURSE_STREAM_URL_UPDATED", entityType: "Course", entityId: id, metadata: { streamUrlConfigured: Boolean(parsed.data.streamUrl), quarantined } });
  const rescheduled = await rescheduleCourseAutomations(id).catch(() => null);
  return NextResponse.json({ ok: true, quarantined, rescheduled });
}
