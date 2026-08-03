import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { AdminSession } from "@/lib/auth/session";

const SOURCE = "wordpress";
const wordpressCourseSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
  slug: z.string().min(1).max(300),
  link: z.string().url(),
  modified_gmt: z.string().optional(),
  modified: z.string().optional(),
  title: z.union([z.string(), z.object({ rendered: z.string() })]),
  acf: z.record(z.unknown()).optional(),
});

export type WordPressCourse = {
  externalId: string;
  officialSlug: string;
  officialUrl: string;
  title: string;
  crmSlug: string | null;
  sourceUpdatedAt: Date | null;
};

function plainTitle(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "–").replace(/&#8217;|&rsquo;/g, "’").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

export function normalizeWordPressCourse(input: unknown): WordPressCourse {
  const parsed = wordpressCourseSchema.parse(input);
  const renderedTitle = typeof parsed.title === "string" ? parsed.title : parsed.title.rendered;
  const crmSlug = typeof parsed.acf?.crm_slug === "string" && parsed.acf.crm_slug.trim() ? parsed.acf.crm_slug.trim() : null;
  const modified = parsed.modified_gmt ?? parsed.modified;
  const sourceUpdatedAt = modified && !Number.isNaN(new Date(`${modified}${modified.endsWith("Z") ? "" : "Z"}`).getTime())
    ? new Date(`${modified}${modified.endsWith("Z") ? "" : "Z"}`)
    : null;
  return { externalId: String(parsed.id), officialSlug: parsed.slug, officialUrl: parsed.link, title: plainTitle(renderedTitle), crmSlug, sourceUpdatedAt };
}

export function wordpressCatalogConfigured() {
  return Boolean(process.env.WORDPRESS_COURSES_API_URL?.trim());
}

export function safeWordPressErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^WORDPRESS_[A-Z0-9_]+$/.test(message) ? message : "WORDPRESS_SYNC_FAILED";
}

export async function fetchWordPressCourses(fetcher: typeof fetch = fetch): Promise<WordPressCourse[]> {
  const configured = process.env.WORDPRESS_COURSES_API_URL?.trim();
  if (!configured) throw new Error("WORDPRESS_API_URL_MISSING");
  const endpoint = new URL(configured);
  if (endpoint.protocol !== "https:") throw new Error("WORDPRESS_API_REQUIRES_HTTPS");
  const user = process.env.WORDPRESS_API_USER?.trim();
  const password = process.env.WORDPRESS_API_APP_PASSWORD?.trim();
  if (Boolean(user) !== Boolean(password)) throw new Error("WORDPRESS_API_CREDENTIALS_INCOMPLETE");
  const headers: HeadersInit = { Accept: "application/json" };
  if (user && password) headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  const courses: WordPressCourse[] = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, 20); page++) {
    endpoint.searchParams.set("per_page", "100");
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("_fields", "id,slug,link,modified_gmt,modified,title,acf");
    const response = await fetcher(endpoint, { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`WORDPRESS_API_HTTP_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("WORDPRESS_API_INVALID_RESPONSE");
    courses.push(...payload.map(normalizeWordPressCourse));
    totalPages = Math.max(1, Number(response.headers.get("x-wp-totalpages")) || 1);
  }
  const ids = new Set<string>();
  for (const course of courses) {
    if (ids.has(course.externalId)) throw new Error("WORDPRESS_API_DUPLICATE_EXTERNAL_ID");
    ids.add(course.externalId);
  }
  return courses;
}

export async function synchronizeWordPressCatalog(session: AdminSession, fetcher: typeof fetch = fetch) {
  if (process.env.VERCEL_ENV === "production") throw new Error("WORDPRESS_SYNC_PREVIEW_ONLY");
  const run = await prisma.catalogSyncRun.create({ data: { source: SOURCE } });
  try {
    const sourceCourses = await fetchWordPressCourses(fetcher);
    let created = 0; let updated = 0; let conflicts = 0; const errors = 0;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(68294113)::text AS lock_result`;
      for (const source of sourceCourses) {
        const existing = await tx.course.findUnique({ where: { externalSource_externalId: { externalSource: SOURCE, externalId: source.externalId } } });
        if (existing) {
          await tx.course.update({ where: { id: existing.id }, data: { officialSlug: source.officialSlug, officialUrl: source.officialUrl, lastSyncedAt: new Date(), sourceUpdatedAt: source.sourceUpdatedAt, syncStatus: "SYNCED", syncError: null } });
          updated++;
          continue;
        }
        if (!source.crmSlug) {
          conflicts++;
          continue;
        }
        const slugConflict = await tx.course.findFirst({ where: { OR: [{ slug: source.crmSlug }, { crmSlug: source.crmSlug }] }, select: { id: true } });
        if (slugConflict) {
          await tx.course.update({ where: { id: slugConflict.id }, data: { syncStatus: "CONFLICT", syncError: `Requiere vinculación explícita con WordPress ID ${source.externalId}.` } });
          conflicts++;
          continue;
        }
        await tx.course.create({ data: { slug: source.crmSlug, crmSlug: source.crmSlug, title: source.title, officialCourseUrl: source.officialUrl, officialUrl: source.officialUrl, officialSlug: source.officialSlug, externalSource: SOURCE, externalId: source.externalId, sourceUpdatedAt: source.sourceUpdatedAt, lastSyncedAt: new Date(), syncStatus: "SYNCED", isPublished: false, acceptsRegistrations: false } });
        created++;
      }
      await tx.catalogSyncRun.update({ where: { id: run.id }, data: { status: conflicts || errors ? "CONFLICT" : "SYNCED", discovered: sourceCourses.length, created, updated, conflicts, errors, completedAt: new Date(), metadata: { externalSource: SOURCE, missingItemsDeleted: 0, internalFieldsOverwritten: false } } });
    });
    await writeAudit({ session, action: "WORDPRESS_CATALOG_SYNCED", entityType: "CatalogSyncRun", entityId: run.id, metadata: { discovered: sourceCourses.length, created, updated, conflicts, errors, readOnly: true } });
    return { runId: run.id, discovered: sourceCourses.length, created, updated, conflicts, errors };
  } catch (error) {
    const code = safeWordPressErrorCode(error);
    await prisma.catalogSyncRun.update({ where: { id: run.id }, data: { status: "ERROR", errors: 1, error: code, completedAt: new Date() } });
    await writeAudit({ session, action: "WORDPRESS_CATALOG_SYNC_FAILED", entityType: "CatalogSyncRun", entityId: run.id, result: "FAILURE", metadata: { code, readOnly: true } });
    throw error;
  }
}
