import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { courseSessionData, courseSessionSchema, courseStreamUrlSchema } from "@/lib/course-session-validation";
import { prisma } from "@/lib/db";
import { markCourseAutomationReconcilePending, reconcileCourseDerivedState } from "@/lib/nurture/course-reconciliation";
import { quarantineCourseCalendarDependentMessages, quarantineRecoverableMessages } from "@/lib/nurture/queue-safety";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Crea una sesion del curso y recalcula los recordatorios pendientes.
 *
 * La sesión nueva en sí no tiene mensajes previos que proteger (no existía),
 * pero AGREGARLA sí cambia `totalSessions` para las que ya existían -de 2 a
 * 3 sesiones, "1 de 2" pasa a describir mal un calendario que ahora tiene 3-,
 * así que sus mensajes recuperables SÍ necesitan recalcularse. Cuarentena y
 * creación van en la misma transacción, con el flag persistente marcado ahí
 * mismo: si el recálculo posterior falla, el cron lo recupera solo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = courseSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  let quarantined = 0;
  const session = await prisma.$transaction(async (tx) => {
    quarantined = await quarantineCourseCalendarDependentMessages(
      tx,
      id,
      { errorCode: "SCHEDULE_RECONCILING", errorMessage: "El calendario cambió y este aviso está esperando ser recalculado." },
    );
    const creada = await tx.courseSession.create({ data: { courseId: id, ...courseSessionData(parsed.data) } });
    await markCourseAutomationReconcilePending(tx, id, "SESSION_CREATED");
    return creada;
  });
  await writeAudit({ session: auth.session, action: "COURSE_SESSION_CREATED", entityType: "CourseSession", entityId: session.id, metadata: { courseId: id, startAt: session.startAt.toISOString(), streamUrlConfigured: Boolean(session.streamUrl), quarantined } });
  // La sesión ya está creada a partir de aquí: un fallo de la reconciliación
  // nunca puede parecer que la creación entera no ocurrió, y ya no hace
  // falta pedir un reintento manual -- el flag persistente lo cubre.
  const reconciled = await reconcileCourseDerivedState(id, auth.session);
  return NextResponse.json({ ok: true, session, quarantined, pending: !reconciled.ok, reconciled }, { status: 201 });
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
    await markCourseAutomationReconcilePending(tx, id, "STREAM_URL_CHANGED");
  });
  await writeAudit({ session: auth.session, action: "COURSE_STREAM_URL_UPDATED", entityType: "Course", entityId: id, metadata: { streamUrlConfigured: Boolean(parsed.data.streamUrl), quarantined } });
  const reconciled = await reconcileCourseDerivedState(id, auth.session);
  return NextResponse.json({ ok: true, quarantined, pending: !reconciled.ok, reconciled });
}
