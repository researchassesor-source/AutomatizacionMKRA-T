import { seedCourses, type SeedCourse } from "@/data/courses";

export type CourseRelations = {
  interests: number;
  enrollments: number;
  messages: number;
  followUps: number;
  audits: number;
  financeHandoffs: number;
  moodleCompletions: number;
};

export type CrmCatalogCourse = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  officialCourseUrl: string;
  price: number | null;
  duration: string | null;
  modality: string | null;
  isFree: boolean;
  isPublished: boolean;
  acceptsRegistrations: boolean;
  relations: CourseRelations;
};

export type CatalogDifferenceStatus =
  | "MATCH"
  | "MISSING_IN_CRM"
  | "EXTRA_IN_CRM"
  | "DIFFERENT";

export type CatalogDifference = {
  slug: string;
  status: CatalogDifferenceStatus;
  official: SeedCourse | null;
  crm: CrmCatalogCourse | null;
  fields: string[];
};

export type CourseCatalogReport = {
  sourceUrl: string;
  checkedAt: string;
  summary: Record<CatalogDifferenceStatus, number>;
  actions: {
    create: number;
    update: number;
    deactivate: number;
    delete: 0;
  };
  differences: CatalogDifference[];
};

const comparableFields = [
  "title",
  "category",
  "officialCourseUrl",
  "price",
  "duration",
  "modality",
  "isFree",
  "isPublished",
  "acceptsRegistrations",
] as const;

function normalized(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return value.trim().replace(/\/$/, "");
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

export function buildCourseCatalogReport(
  crmCourses: CrmCatalogCourse[],
  checkedAt = new Date(),
): CourseCatalogReport {
  const bySlug = new Map(crmCourses.map((course) => [course.slug, course]));
  const differences: CatalogDifference[] = seedCourses.map((official) => {
    const crm = bySlug.get(official.slug) ?? null;
    if (!crm) {
      return { slug: official.slug, status: "MISSING_IN_CRM" as const, official, crm, fields: ["registro"] };
    }
    bySlug.delete(official.slug);
    const fields = comparableFields.filter((field) => normalized(official[field]) !== normalized(crm[field]));
    return {
      slug: official.slug,
      status: fields.length ? "DIFFERENT" as const : "MATCH" as const,
      official,
      crm,
      fields: [...fields],
    };
  });

  for (const crm of bySlug.values()) {
    differences.push({ slug: crm.slug, status: "EXTRA_IN_CRM", official: null, crm, fields: ["registro"] });
  }

  const summary: CourseCatalogReport["summary"] = {
    MATCH: 0,
    MISSING_IN_CRM: 0,
    EXTRA_IN_CRM: 0,
    DIFFERENT: 0,
  };
  for (const difference of differences) summary[difference.status]++;
  return {
    sourceUrl: "https://ra-training.com/courses-1/",
    checkedAt: checkedAt.toISOString(),
    summary,
    actions: {
      create: summary.MISSING_IN_CRM,
      update: summary.DIFFERENT,
      deactivate: differences.filter((item) => item.status === "EXTRA_IN_CRM" && item.crm?.isPublished).length,
      delete: 0,
    },
    differences,
  };
}

export function officialCourseMutationData(course: SeedCourse) {
  return {
    ...course,
    benefits: course.benefits,
  };
}

export function canApplyCourseCatalog(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV === "production") {
    return env.ALLOW_PRODUCTION_COURSE_CATALOG_IMPORT === "true";
  }
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") return true;
  return env.NODE_ENV !== "production";
}
