import "server-only";
import { prisma } from "@/lib/db";
import { buildCourseCatalogReport, type CrmCatalogCourse } from "@/lib/course-catalog";

export async function loadCourseCatalogReport() {
  const courses = await prisma.course.findMany({
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
    include: { _count: { select: { enrollments: true, legacyLeads: true } } },
  });
  const rows: CrmCatalogCourse[] = await Promise.all(courses.map(async (course) => {
    const [messages, followUps, audits] = await Promise.all([
      prisma.outboundMessage.count({ where: { enrollment: { courseId: course.id } } }),
      prisma.followUp.count({
        where: {
          lead: {
            OR: [
              { courseId: course.id },
              { enrollments: { some: { courseId: course.id } } },
            ],
          },
        },
      }),
      prisma.auditLog.count({ where: { entityType: "Course", entityId: course.id } }),
    ]);
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      category: course.category,
      officialCourseUrl: course.officialCourseUrl,
      price: course.price === null ? null : Number(course.price),
      duration: course.duration,
      modality: course.modality,
      isFree: course.isFree,
      isPublished: course.isPublished,
      relations: {
        interests: course._count.legacyLeads,
        enrollments: course._count.enrollments,
        messages,
        followUps,
        audits,
      },
    };
  }));
  return buildCourseCatalogReport(rows);
}
