import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { courseData, courseInputSchema } from "@/lib/course-validation";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = courseInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }
  const { id } = await params;
  try {
    const course = await prisma.course.update({ where: { id }, data: courseData(parsed.data) });
    await writeAudit({ session: auth.session, action: "COURSE_UPDATED", entityType: "Course", entityId: id });
    return NextResponse.json({ ok: true, course });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar el curso." }, { status: 409 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  const count = await prisma.enrollment.count({ where: { courseId: id } });
  if (count > 0) {
    await prisma.course.update({ where: { id }, data: { isPublished: false } });
    await writeAudit({ session: auth.session, action: "COURSE_DEACTIVATED", entityType: "Course", entityId: id });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.course.delete({ where: { id } });
  await writeAudit({ session: auth.session, action: "COURSE_DELETED", entityType: "Course", entityId: id });
  return NextResponse.json({ ok: true, deleted: true });
}
