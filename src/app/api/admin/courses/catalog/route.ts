import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { seedCourses } from "@/data/courses";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { canApplyCourseCatalog, officialCourseMutationData } from "@/lib/course-catalog";
import { loadCourseCatalogReport } from "@/lib/course-catalog-server";
import { prisma } from "@/lib/db";

const applySchema = z.object({ confirm: z.literal("IMPORTAR_CATALOGO_OFICIAL") });

export async function GET(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING", "VENTAS", "LECTURA"]);
  if (auth.error) return auth.error;
  return NextResponse.json(await loadCourseCatalogReport());
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  if (!canApplyCourseCatalog()) {
    return NextResponse.json(
      { error: "La importación automática del catálogo está bloqueada en Producción." },
      { status: 409 },
    );
  }
  const parsed = applySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "La confirmación del catálogo no es válida." }, { status: 422 });
  }

  const before = await loadCourseCatalogReport();
  await prisma.$transaction(async (tx) => {
    for (const course of seedCourses) {
      const data = officialCourseMutationData(course);
      await tx.course.upsert({ where: { slug: course.slug }, create: data, update: data });
    }
    await tx.course.updateMany({
      where: { slug: { notIn: seedCourses.map((course) => course.slug) }, isPublished: true },
      data: { isPublished: false },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await writeAudit({
    session: auth.session,
    action: "COURSE_CATALOG_IMPORTED",
    entityType: "CourseCatalog",
    metadata: { ...before.summary, sourceUrl: before.sourceUrl, preservedHistory: true },
  });
  return NextResponse.json({ ok: true, report: await loadCourseCatalogReport() });
}
