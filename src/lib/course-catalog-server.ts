import "server-only";
import type { Prisma } from "@prisma/client";
import { sanitizeAuditMetadata } from "@/lib/audit";
import type { AdminSession } from "@/lib/auth/session";
import {
  buildCourseCatalogReport,
  officialCourseMutationData,
  type CrmCatalogCourse,
} from "@/lib/course-catalog";
import { prisma } from "@/lib/db";

type CatalogDatabase = Pick<
  Prisma.TransactionClient,
  "course" | "outboundMessage" | "followUp" | "auditLog" | "enrollment"
>;

async function loadCourseCatalogReportWith(database: CatalogDatabase) {
  const courses = await database.course.findMany({
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
    include: { _count: { select: { enrollments: true, legacyLeads: true } } },
  });
  const rows: CrmCatalogCourse[] = await Promise.all(courses.map(async (course) => {
    const [messages, followUps, audits, financeHandoffs, moodleCompletions] = await Promise.all([
      database.outboundMessage.count({ where: { enrollment: { courseId: course.id } } }),
      database.followUp.count({
        where: {
          lead: {
            OR: [
              { courseId: course.id },
              { enrollments: { some: { courseId: course.id } } },
            ],
          },
        },
      }),
      database.auditLog.count({ where: { entityType: "Course", entityId: course.id } }),
      database.enrollment.count({ where: { courseId: course.id, financeStatus: { not: "NO_ENVIADO" } } }),
      database.enrollment.count({ where: { courseId: course.id, moodleCompletionDate: { not: null } } }),
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
      acceptsRegistrations: course.acceptsRegistrations,
      relations: {
        interests: course._count.legacyLeads,
        enrollments: course._count.enrollments,
        messages,
        followUps,
        audits,
        financeHandoffs,
        moodleCompletions,
      },
    };
  }));
  return buildCourseCatalogReport(rows);
}

export async function loadCourseCatalogReport() {
  return loadCourseCatalogReportWith(prisma);
}

export async function applyOfficialCourseCatalog(session: AdminSession) {
  const changes = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(74231983)::text AS lock_result`;
    const before = await loadCourseCatalogReportWith(tx);
    const created = before.differences.filter((item) => item.status === "MISSING_IN_CRM");
    const updated = before.differences.filter((item) => item.status === "DIFFERENT");
    const historical = before.differences.filter(
      (item) => item.status === "EXTRA_IN_CRM" && item.crm?.isPublished,
    );

    for (const difference of [...created, ...updated]) {
      if (!difference.official) continue;
      const data = officialCourseMutationData(difference.official);
      await tx.course.upsert({
        where: { slug: difference.official.slug },
        create: data,
        update: data,
      });
    }

    for (const difference of historical) {
      if (!difference.crm) continue;
      await tx.course.update({ where: { id: difference.crm.id }, data: { isPublished: false } });
      await tx.auditLog.create({
        data: {
          actorId: session.userId ?? null,
          actorEmail: session.email ?? null,
          action: "COURSE_CATALOG_HISTORICAL_DEACTIVATED",
          entityType: "Course",
          entityId: difference.crm.id,
          result: "SUCCESS",
          metadata: sanitizeAuditMetadata({
            slug: difference.crm.slug,
            previousState: "ACTIVE",
            newState: "INACTIVE",
            reason: "Curso histórico fuera del catálogo oficial vigente.",
            relations: difference.crm.relations,
            preservedHistory: true,
          }),
        },
      });
    }

    const result = {
      created: created.length,
      updated: updated.length,
      deactivated: historical.length,
      deleted: 0,
      historicalPreserved: before.summary.EXTRA_IN_CRM,
    };
    await tx.auditLog.create({
      data: {
        actorId: session.userId ?? null,
        actorEmail: session.email ?? null,
        action: created.length || updated.length || historical.length
          ? "COURSE_CATALOG_IMPORTED"
          : "COURSE_CATALOG_IMPORT_NO_CHANGES",
        entityType: "CourseCatalog",
        result: "SUCCESS",
        metadata: sanitizeAuditMetadata({
          ...result,
          sourceUrl: before.sourceUrl,
          preservedHistory: true,
        }),
      },
    });
    return result;
  }, {
    isolationLevel: "Serializable",
    maxWait: 5_000,
    timeout: 20_000,
  });

  return { changes, report: await loadCourseCatalogReport() };
}
