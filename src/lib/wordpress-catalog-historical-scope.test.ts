// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles de Prisma usan objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    catalogSyncRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    automationRule: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(),
  },
  tx: {
    $queryRaw: vi.fn(async () => undefined),
    course: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    automationRule: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(async () => 0) },
    outboundMessage: { updateMany: vi.fn(async (_args: any) => ({ count: 0 })) },
    auditLog: { create: vi.fn(async () => undefined) },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { synchronizeWordPressCatalog } from "./wordpress-catalog";

/**
 * Riesgo confirmado: reconcileCatalogAndAutomations marcaba HISTORICAL a
 * cualquier Course que no apareciera en el fetch de WordPress, sin comprobar
 * si ese curso pertenecía siquiera a esa fuente. Un curso manual, interno, o
 * vinculado a otra fuente (Moodle, etc.) nunca puede aparecer en ese fetch —
 * no porque haya desaparecido del sitio, sino porque nunca vivió ahí.
 */
type StoredCourse = {
  id: string;
  slug: string;
  crmSlug: string | null;
  title: string;
  officialCourseUrl: string;
  officialUrl: string;
  officialSlug: string | null;
  externalSource: string | null;
  externalId: string | null;
  isPublished: boolean;
  acceptsRegistrations: boolean;
  syncStatus: string;
  syncError: string | null;
  sourceUpdatedAt: Date | null;
  lastSyncedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

function baseCourse(overrides: Partial<StoredCourse> & { id: string }): StoredCourse {
  return {
    slug: overrides.id,
    crmSlug: overrides.id,
    title: "Curso",
    officialCourseUrl: "https://ra-training.com/courses-1/",
    officialUrl: "https://ra-training.com/courses-1/",
    officialSlug: overrides.id,
    externalSource: null,
    externalId: null,
    isPublished: true,
    acceptsRegistrations: true,
    syncStatus: "SYNCED",
    syncError: null,
    sourceUpdatedAt: null,
    lastSyncedAt: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

function ruleFor(id: string, course: StoredCourse) {
  return {
    id,
    name: id,
    trigger: "ON_REGISTRATION" as const,
    channel: "WHATSAPP" as const,
    subject: null as string | null,
    body: "contenido",
    status: "ACTIVE",
    course: {
      id: course.id,
      title: course.title,
      slug: course.slug,
      externalId: course.externalId,
      externalSource: course.externalSource,
      isPublished: course.isPublished,
      acceptsRegistrations: course.acceptsRegistrations,
      startsAt: course.startsAt,
      endsAt: course.endsAt,
      sessions: [] as unknown[],
    },
  };
}

function wpSource(externalId: string) {
  return { id: Number(externalId), slug: `curso-${externalId}`, link: `https://ra-training.com/cursos/curso-${externalId}/`, modified_gmt: "2026-08-10T12:00:00", status: "publish", title: { rendered: `Curso ${externalId}` } };
}

function fetcherFor(sourceCourses: ReturnType<typeof wpSource>[]) {
  return vi.fn(async () => new Response(JSON.stringify(sourceCourses), { status: 200, headers: { "x-wp-totalpages": "1", "x-wp-total": String(sourceCourses.length) } })) as unknown as typeof fetch;
}

const session = { userId: "admin-1", email: "tecnico@example.test", role: "ADMIN" } as any;

let courses: StoredCourse[];
let rules: Array<ReturnType<typeof ruleFor>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORDPRESS_COURSES_API_URL", "https://ra-training.com/wp-json/wp/v2/cursos?per_page=100");
  courses = [];
  rules = [];

  mocks.prisma.catalogSyncRun.findFirst.mockResolvedValue(null);
  mocks.prisma.catalogSyncRun.create.mockResolvedValue({ id: "run-1" });
  mocks.prisma.catalogSyncRun.update.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));

  mocks.tx.course.findMany.mockImplementation(async (args: any = {}) => {
    if (args.where?.id?.in) return courses.filter((c) => args.where.id.in.includes(c.id));
    return [...courses];
  });
  mocks.tx.course.findUniqueOrThrow.mockImplementation(async ({ where }: any) => {
    const found = courses.find((c) => c.id === where.id);
    if (!found) throw new Error(`No existe: ${where.id}`);
    return found;
  });
  mocks.tx.course.update.mockImplementation(async ({ where, data }: any) => {
    const found = courses.find((c) => c.id === where.id);
    if (!found) throw new Error(`No existe: ${where.id}`);
    Object.assign(found, data);
    return found;
  });
  mocks.tx.automationRule.findMany.mockImplementation(async () => [...rules]);
  mocks.tx.automationRule.updateMany.mockImplementation(async ({ where, data }: any) => {
    const ids: string[] = where.id.in;
    let count = 0;
    for (const rule of rules) {
      if (ids.includes(rule.id)) {
        Object.assign(rule, data);
        count++;
      }
    }
    return { count };
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("4/5/6/7: HISTORICAL solo alcanza a cursos realmente gestionados por WordPress", () => {
  it("curso manual, curso de otra fuente y curso WordPress presente quedan intactos; solo el WordPress ausente se historiza", async () => {
    courses = [
      baseCourse({ id: "course-wp-present", externalSource: "wordpress", externalId: "100" }),
      baseCourse({ id: "course-manual", externalSource: null, externalId: null }),
      baseCourse({ id: "course-moodle", externalSource: "moodle", externalId: "m-1" }),
      baseCourse({ id: "course-wp-missing", externalSource: "wordpress", externalId: "200" }),
    ];
    rules = [
      ruleFor("rule-manual", courses[1]),
      ruleFor("rule-moodle", courses[2]),
      ruleFor("rule-wp-missing", courses[3]),
    ];
    // El fetch solo trae al curso "100": "200" ya no aparece en el catálogo.
    const fetcher = fetcherFor([wpSource("100")]);

    const result = await synchronizeWordPressCatalog(session, fetcher);

    expect(result.errors).toBe(0);
    const manual = courses.find((c) => c.id === "course-manual");
    const moodle = courses.find((c) => c.id === "course-moodle");
    const wpPresent = courses.find((c) => c.id === "course-wp-present");
    const wpMissing = courses.find((c) => c.id === "course-wp-missing");

    // 4: curso manual intacto.
    expect(manual).toMatchObject({ isPublished: true, acceptsRegistrations: true, syncStatus: "SYNCED" });
    // 5: curso de otra fuente intacto.
    expect(moodle).toMatchObject({ isPublished: true, acceptsRegistrations: true, syncStatus: "SYNCED" });
    // 7: curso WordPress presente sigue con comportamiento normal.
    expect(wpPresent?.syncStatus).not.toBe("HISTORICAL");
    expect(wpPresent?.isPublished).toBe(true);
    // 6: curso WordPress genuinamente ausente del catálogo completo sí se historiza.
    expect(wpMissing).toMatchObject({ isPublished: false, acceptsRegistrations: false, syncStatus: "HISTORICAL" });

    const ruleManual = rules.find((r) => r.id === "rule-manual");
    const ruleMoodle = rules.find((r) => r.id === "rule-moodle");
    const ruleWpMissing = rules.find((r) => r.id === "rule-wp-missing");
    expect(ruleManual?.status).toBe("ACTIVE");
    expect(ruleMoodle?.status).toBe("ACTIVE");
    expect(ruleWpMissing?.status).toBe("PAUSED");
  });

  /**
   * La regla queda PAUSED (reversible), no ARCHIVED. Sus mensajes pendientes
   * deben quedar OMITIDO (reprogramable), no CANCELADO: si alguien reactiva la
   * regla a mano después de que el curso volviera a estar vigente,
   * rescheduleCourseAutomations necesita poder recuperarlos.
   */
  it("los mensajes pendientes de la regla pausada por el sync quedan OMITIDO, no CANCELADO", async () => {
    courses = [
      baseCourse({ id: "course-wp-present", externalSource: "wordpress", externalId: "100" }),
      baseCourse({ id: "course-wp-missing", externalSource: "wordpress", externalId: "200" }),
    ];
    rules = [ruleFor("rule-wp-missing", courses[1])];
    // Catálogo no vacío (trae "100"): "200" está genuinamente ausente, no es
    // un catálogo vacío que dispararía el guardián fail-closed aparte.
    const fetcher = fetcherFor([wpSource("100")]);

    await synchronizeWordPressCatalog(session, fetcher);

    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { automationRuleId: { in: ["rule-wp-missing"] }, status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "COURSE_NOT_ELIGIBLE", nextAttemptAt: null }),
    });
  });
});

describe("catálogo inválido: cero reconciliación, no solo el fetch falla", () => {
  it("X-WP-Total incompleto: ningún curso ni regla se toca", async () => {
    courses = [baseCourse({ id: "course-wp-present", externalSource: "wordpress", externalId: "100" })];
    rules = [ruleFor("rule-1", courses[0])];
    const snapshotCourse = { ...courses[0] };
    const snapshotRule = { ...rules[0] };
    // X-WP-Total dice 5 pero solo llega 1 curso: catálogo parcial.
    const fetcher = vi.fn(async () => new Response(JSON.stringify([wpSource("100")]), { status: 200, headers: { "x-wp-totalpages": "1", "x-wp-total": "5" } })) as unknown as typeof fetch;

    await expect(synchronizeWordPressCatalog(session, fetcher)).rejects.toThrow("WORDPRESS_API_INCOMPLETE_CATALOG");
    expect(courses[0]).toEqual(snapshotCourse);
    expect(rules[0]).toEqual(snapshotRule);
    expect(mocks.tx.course.update).not.toHaveBeenCalled();
    expect(mocks.tx.automationRule.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  it("catálogo vacío declarado (X-WP-Total=0): fail closed, nada se historiza", async () => {
    courses = [baseCourse({ id: "course-wp-present", externalSource: "wordpress", externalId: "100" })];
    const snapshotCourse = { ...courses[0] };
    const fetcher = vi.fn(async () => new Response(JSON.stringify([]), { status: 200, headers: { "x-wp-totalpages": "1", "x-wp-total": "0" } })) as unknown as typeof fetch;

    await expect(synchronizeWordPressCatalog(session, fetcher)).rejects.toThrow("WORDPRESS_API_EMPTY_CATALOG");
    expect(courses[0]).toEqual(snapshotCourse);
    expect(mocks.tx.course.update).not.toHaveBeenCalled();
  });
});
