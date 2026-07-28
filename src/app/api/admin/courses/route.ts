import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { courseData, courseInputSchema } from "@/lib/course-validation";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING", "VENTAS", "LECTURA"]);
  if (auth.error) return auth.error;
  const courses = await prisma.course.findMany({ orderBy: [{ displayOrder: "asc" }, { title: "asc" }] });
  return NextResponse.json({ courses });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = courseInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }
  try {
    const course = await prisma.course.create({ data: courseData(parsed.data) });
    await writeAudit({ session: auth.session, action: "COURSE_CREATED", entityType: "Course", entityId: course.id });
    return NextResponse.json({ ok: true, course }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo crear el curso. Revisa que el identificador no esté repetido." }, { status: 409 });
  }
}
