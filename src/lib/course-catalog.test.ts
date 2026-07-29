import { describe, expect, it } from "vitest";
import { seedCourses } from "@/data/courses";
import { buildCourseCatalogReport, canApplyCourseCatalog, type CrmCatalogCourse } from "./course-catalog";

const noRelations = {
  interests: 0,
  enrollments: 0,
  messages: 0,
  followUps: 0,
  audits: 0,
  financeHandoffs: 0,
  moodleCompletions: 0,
};

function officialRows(): CrmCatalogCourse[] {
  return seedCourses.map((course, index) => ({
    id: `course-${index}`,
    slug: course.slug,
    title: course.title,
    category: course.category,
    officialCourseUrl: course.officialCourseUrl,
    price: course.price,
    duration: course.duration,
    modality: course.modality,
    isFree: course.isFree,
    isPublished: course.isPublished,
    relations: noRelations,
  }));
}

describe("auditoría del catálogo", () => {
  it("clasifica como faltante cada curso oficial ausente", () => {
    const report = buildCourseCatalogReport([], new Date("2026-07-29T00:00:00.000Z"));
    expect(report.summary.MISSING_IN_CRM).toBe(seedCourses.length);
    expect(report.summary.EXTRA_IN_CRM).toBe(0);
    expect(report.actions).toEqual({ create: 11, update: 0, deactivate: 0, delete: 0 });
  });

  it("es idempotente cuando el CRM ya coincide", () => {
    const report = buildCourseCatalogReport(officialRows());
    expect(report.summary).toEqual({ MATCH: seedCourses.length, MISSING_IN_CRM: 0, EXTRA_IN_CRM: 0, DIFFERENT: 0 });
    expect(report.actions).toEqual({ create: 0, update: 0, deactivate: 0, delete: 0 });
  });

  it("distingue datos diferentes y registros históricos sin perder sus relaciones", () => {
    const rows = officialRows();
    rows[0] = { ...rows[0], title: "Nombre histórico" };
    rows.push({
      id: "historical-course",
      slug: "curso-historico",
      title: "Curso histórico",
      category: null,
      officialCourseUrl: "https://ra-training.com/courses-1/",
      price: null,
      duration: null,
      modality: null,
      isFree: false,
      isPublished: true,
      relations: { ...noRelations, enrollments: 2, audits: 3 },
    });
    const report = buildCourseCatalogReport(rows);
    expect(report.summary.DIFFERENT).toBe(1);
    expect(report.summary.EXTRA_IN_CRM).toBe(1);
    expect(report.differences.find((item) => item.slug === "curso-historico")?.crm?.relations).toMatchObject({ enrollments: 2, audits: 3 });
    expect(report.actions).toEqual({ create: 0, update: 1, deactivate: 1, delete: 0 });
  });

  it("conserva históricos inactivos en el reporte sin proponer otra mutación", () => {
    const rows = officialRows();
    rows.push({
      id: "historical-course",
      slug: "curso-historico",
      title: "Curso histórico",
      category: null,
      officialCourseUrl: "https://ra-training.com/courses-1/",
      price: null,
      duration: null,
      modality: null,
      isFree: false,
      isPublished: false,
      relations: { ...noRelations, enrollments: 2 },
    });
    const report = buildCourseCatalogReport(rows);
    expect(report.summary.EXTRA_IN_CRM).toBe(1);
    expect(report.actions.deactivate).toBe(0);
  });

  it("bloquea la aplicación automática en Producción", () => {
    expect(canApplyCourseCatalog({ NODE_ENV: "production", VERCEL_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(canApplyCourseCatalog({ NODE_ENV: "production", VERCEL_ENV: "preview" } as NodeJS.ProcessEnv)).toBe(true);
    expect(canApplyCourseCatalog({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(canApplyCourseCatalog({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
