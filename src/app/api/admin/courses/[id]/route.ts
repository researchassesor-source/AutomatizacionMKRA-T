import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { courseData, courseInputSchema } from "@/lib/course-validation";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { CONTENIDO, TECNICO } from "@/lib/auth/roles";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const parsed = courseInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }
  const { id } = await params;
  const current = await prisma.course.findUnique({ where: { id }, select: { isPublished: true } });
  if (!current) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });
  if (current.isPublished && !parsed.data.isPublished && body?.confirm !== true) {
    return NextResponse.json({ error: "Debes confirmar la desactivación del curso." }, { status: 422 });
  }
  try {
    const course = await prisma.course.update({ where: { id }, data: courseData(parsed.data) });
    await writeAudit({ session: auth.session, action: "COURSE_UPDATED", entityType: "Course", entityId: id });
    return NextResponse.json({ ok: true, course });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar el curso." }, { status: 409 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;
  const confirmation = z.object({ confirm: z.literal(true) }).safeParse(await request.json().catch(() => null));
  if (!confirmation.success) return NextResponse.json({ error: "Debes confirmar la desactivación del curso." }, { status: 422 });
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });
  const [enrollments, interests] = await Promise.all([
    prisma.enrollment.count({ where: { courseId: id } }),
    prisma.lead.count({ where: { courseId: id } }),
  ]);
  await prisma.course.update({ where: { id }, data: { isPublished: false } });
  await writeAudit({
    session: auth.session,
    action: "COURSE_DEACTIVATED",
    entityType: "Course",
    entityId: id,
    metadata: { enrollments, interests, preservedHistory: true },
  });
  return NextResponse.json({ ok: true, deactivated: true, preservedHistory: true });
}
