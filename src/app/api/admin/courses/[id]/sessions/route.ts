import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { courseSessionData, courseSessionSchema, courseStreamUrlSchema } from "@/lib/course-session-validation";
import { prisma } from "@/lib/db";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/** Crea una sesion del curso y recalcula los recordatorios pendientes. */
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
  const rescheduled = await rescheduleCourseAutomations(id);
  return NextResponse.json({ ok: true, session, rescheduled }, { status: 201 });
}

/** Actualiza el enlace de transmision por defecto del curso. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = courseStreamUrlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  await prisma.course.update({ where: { id }, data: { streamUrl: parsed.data.streamUrl || null } });
  await writeAudit({ session: auth.session, action: "COURSE_STREAM_URL_UPDATED", entityType: "Course", entityId: id, metadata: { streamUrlConfigured: Boolean(parsed.data.streamUrl) } });
  const rescheduled = await rescheduleCourseAutomations(id);
  return NextResponse.json({ ok: true, rescheduled });
}
