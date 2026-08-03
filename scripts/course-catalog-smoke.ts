import { PrismaClient, type AdminRole } from "@prisma/client";
import { seedCourses } from "../src/data/courses";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();
const baseUrl = "http://localhost:3000";
const suffix = Date.now().toString(36);
const password = "Catalog-QA-only-9x!";
const roleEmails = Object.fromEntries(
  (["ADMIN", "MARKETING", "VENTAS", "LECTURA"] as AdminRole[])
    .map((role) => [role, `${role.toLowerCase()}-catalog-${suffix}@example.test`]),
) as Record<AdminRole, string>;
const historicalSlugs = ["excel-basico-trabajo-historico", "sst-introduccion-historico"];
const leadEmails = historicalSlugs.map((slug) => `${slug}-${suffix}@example.test`);
const publicPhone = `+5939${String(Date.now()).slice(-8)}`;

type CatalogSummary = Partial<Record<"MATCH" | "MISSING_IN_CRM" | "DIFFERENT" | "EXTRA_IN_CRM", number>>;

type SmokeResponseData = {
  summary?: CatalogSummary;
  actions?: { deactivate?: number };
  changes?: { created?: number; updated?: number; deactivated?: number; deleted?: number };
  report?: { summary?: CatalogSummary };
  interestId?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`CATALOG_SMOKE_ASSERTION: ${message}`);
}

function assertIsolatedDatabase() {
  const raw = process.env.POSTGRES_PRISMA_URL ?? "";
  assert(raw, "Falta POSTGRES_PRISMA_URL.");
  const url = new URL(raw);
  assert(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "La prueba solo se permite contra PostgreSQL local.");
  const name = decodeURIComponent(url.pathname.slice(1));
  assert(/^mkra_codex_qa_catalog_[a-z0-9_]+$/.test(name), "La base no tiene el nombre aislado obligatorio.");
}

async function http(path: string, options: RequestInit = {}, cookie?: string) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: "manual" });
  const data = await response.json().catch(() => null) as SmokeResponseData | null;
  return { response, data };
}

async function expectStatus(path: string, status: number, options: RequestInit = {}, cookie?: string) {
  const result = await http(path, options, cookie);
  assert(result.response.status === status, `${path}: esperado ${status}, recibido ${result.response.status}`);
  return result;
}

async function createUser(role: AdminRole) {
  return prisma.adminUser.create({
    data: {
      name: `QA Catálogo ${role}`,
      email: roleEmails[role],
      passwordHash: await hashPassword(password),
      role,
      isActive: true,
    },
  });
}

async function login(role: AdminRole) {
  const result = await expectStatus("/api/admin/login", 200, {
    method: "POST",
    body: JSON.stringify({ email: roleEmails[role], password }),
  });
  const cookie = result.response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie, `El login ${role} no devolvió cookie.`);
  return cookie;
}

async function createHistoricalFixtures(adminId: string) {
  const titles = ["Excel Básico para el Trabajo", "Introducción a la Seguridad y Salud en el Trabajo"];
  const courses = [];
  for (let index = 0; index < historicalSlugs.length; index++) {
    const course = await prisma.course.create({
      data: {
        slug: historicalSlugs[index],
        title: titles[index],
        category: "Histórico QA",
        officialCourseUrl: "https://ra-training.com/courses-1/",
        duration: "8 horas",
        modality: "Virtual",
        isPublished: true,
      },
    });
    const lead = await prisma.lead.create({
      data: {
        fullName: `Contacto histórico ${index + 1}`,
        email: leadEmails[index],
        phone: `+59398${String(Date.now() + index).slice(-7)}`,
        source: "catalog-smoke",
        consent: true,
        courseId: course.id,
      },
    });
    const enrollment = await prisma.enrollment.create({
      data: {
        leadId: lead.id,
        courseId: course.id,
        status: "COMPLETADO",
        moodleCompletionDate: new Date("2026-07-28T15:00:00.000Z"),
        financeStatus: "ENVIADO",
        financeInscripcionId: `catalog-qa-${suffix}-${index}`,
      },
    });
    await prisma.followUp.create({
      data: { leadId: lead.id, assignedToId: adminId, type: "WHATSAPP", dueAt: new Date(), notes: "Relación QA" },
    });
    await prisma.outboundMessage.create({
      data: {
        leadId: lead.id,
        enrollmentId: enrollment.id,
        channel: "WHATSAPP",
        toAddress: lead.phone ?? "",
        body: "Mensaje histórico QA",
        status: "SIMULADO",
        scheduledAt: new Date(),
        isSimulation: true,
      },
    });
    await prisma.auditLog.create({
      data: { actorId: adminId, actorEmail: roleEmails.ADMIN, action: "COURSE_QA_RELATION_CREATED", entityType: "Course", entityId: course.id, result: "SUCCESS" },
    });
    courses.push(course);
  }
  return courses;
}

async function cleanup() {
  const leads = await prisma.lead.findMany({
    where: { OR: [{ email: { in: leadEmails } }, { phone: publicPhone }] },
    select: { id: true },
  });
  const courses = await prisma.course.findMany({
    where: { slug: { in: [...historicalSlugs, ...seedCourses.map((course) => course.slug)] } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorEmail: { in: Object.values(roleEmails) } },
        { entityId: { in: [...leads.map((item) => item.id), ...courses.map((item) => item.id)] } },
      ],
    },
  });
  await prisma.lead.deleteMany({ where: { id: { in: leads.map((item) => item.id) } } });
  await prisma.course.deleteMany({ where: { id: { in: courses.map((item) => item.id) } } });
  await prisma.adminUser.deleteMany({ where: { email: { in: Object.values(roleEmails) } } });
}

async function main() {
  assertIsolatedDatabase();
  await cleanup();
  const users = await Promise.all((Object.keys(roleEmails) as AdminRole[]).map(createUser));
  const admin = users.find((user) => user.role === "ADMIN");
  assert(admin, "No se creó el administrador QA.");
  const historical = await createHistoricalFixtures(admin.id);
  const relationCountsBefore = await Promise.all(historical.map(async (course) => ({
    enrollments: await prisma.enrollment.count({ where: { courseId: course.id } }),
    messages: await prisma.outboundMessage.count({ where: { enrollment: { courseId: course.id } } }),
    followUps: await prisma.followUp.count({ where: { lead: { courseId: course.id } } }),
    finance: await prisma.enrollment.count({ where: { courseId: course.id, financeStatus: { not: "NO_ENVIADO" } } }),
    moodle: await prisma.enrollment.count({ where: { courseId: course.id, moodleCompletionDate: { not: null } } }),
  })));

  const cookies = Object.fromEntries(await Promise.all(
    (Object.keys(roleEmails) as AdminRole[]).map(async (role) => [role, await login(role)]),
  )) as Record<AdminRole, string>;

  const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert([307, 308].includes(root.status), "/ no redirigió en servidor.");
  assert(new URL(root.headers.get("location") ?? "", baseUrl).pathname === "/admin/login", "/ no redirigió al login.");
  const anonymousAdmin = await fetch(`${baseUrl}/admin`, { redirect: "manual" });
  assert([307, 308].includes(anonymousAdmin.status), "/admin anónimo no redirigió.");
  assert((await fetch(`${baseUrl}/admin`, { headers: { cookie: cookies.ADMIN }, redirect: "manual" })).status === 200, "/admin autenticado no abrió el panel.");

  const initial = await expectStatus("/api/admin/courses/catalog", 200, {}, cookies.ADMIN);
  assert(initial.data?.summary?.MISSING_IN_CRM === 11, "La comparación inicial no detectó 11 faltantes.");
  assert(initial.data?.summary?.EXTRA_IN_CRM === 2, "La comparación inicial no detectó 2 históricos.");
  assert(initial.data?.actions?.deactivate === 2, "No propuso desactivar los 2 históricos.");

  for (const role of ["MARKETING", "VENTAS", "LECTURA"] as AdminRole[]) {
    await expectStatus("/api/admin/courses/catalog", 403, {}, cookies[role]);
    await expectStatus("/api/admin/courses/catalog", 403, {
      method: "POST",
      body: JSON.stringify({ confirm: "IMPORTAR_CATALOGO_OFICIAL" }),
    }, cookies[role]);
  }
  await expectStatus("/api/admin/courses/catalog", 422, { method: "POST", body: JSON.stringify({ confirm: "NO" }) }, cookies.ADMIN);
  await expectStatus("/api/admin/courses/catalog", 413, {
    method: "POST",
    body: JSON.stringify({ confirm: "IMPORTAR_CATALOGO_OFICIAL", padding: "x".repeat(5_000) }),
  }, cookies.ADMIN);

  const firstImport = await expectStatus("/api/admin/courses/catalog", 200, {
    method: "POST",
    body: JSON.stringify({ confirm: "IMPORTAR_CATALOGO_OFICIAL" }),
  }, cookies.ADMIN);
  assert(firstImport.data?.changes?.created === 11, "La primera importación no creó 11 cursos.");
  assert(firstImport.data?.changes?.updated === 0, "La primera importación actualizó registros inesperados.");
  assert(firstImport.data?.changes?.deactivated === 2, "La primera importación no desactivó 2 históricos.");
  assert(firstImport.data?.changes?.deleted === 0, "La importación eliminó registros.");
  assert(firstImport.data?.report?.summary?.MATCH === 11, "El resultado no contiene 11 coincidentes.");
  assert(firstImport.data?.report?.summary?.MISSING_IN_CRM === 0, "Quedaron cursos faltantes.");
  assert(firstImport.data?.report?.summary?.DIFFERENT === 0, "Quedaron cursos distintos.");
  assert(firstImport.data?.report?.summary?.EXTRA_IN_CRM === 2, "No conservó los 2 históricos en el reporte.");

  assert(await prisma.course.count({ where: { slug: { in: seedCourses.map((course) => course.slug) }, isPublished: true } }) === 11, "No hay 11 cursos oficiales activos.");
  assert(await prisma.course.count({ where: { id: { in: historical.map((course) => course.id) }, isPublished: false } }) === 2, "Los históricos no quedaron inactivos.");
  const activeCoursePage = await fetch(`${baseUrl}/cursos/${seedCourses[0].slug}`, { redirect: "manual" });
  assert(activeCoursePage.status === 200, "Un curso oficial activo no abrió su página pública.");
  const inactiveCoursePage = await fetch(`${baseUrl}/cursos/${historicalSlugs[0]}`, { redirect: "manual" });
  assert(inactiveCoursePage.status === 404, "Un curso histórico todavía expone una página pública.");
  const activeAdminPage = await fetch(`${baseUrl}/admin/cursos`, { headers: { cookie: cookies.ADMIN } });
  const activeAdminHtml = await activeAdminPage.text();
  const activeCourseTable = activeAdminHtml.match(/<table class="data course-admin-table">[\s\S]*?<\/table>/)?.[0] ?? "";
  assert(activeAdminPage.status === 200 && activeCourseTable.includes(seedCourses[0].title), "La vista Activos no muestra cursos oficiales.");
  assert(!activeCourseTable.includes("Excel Básico para el Trabajo"), "La vista Activos todavía muestra un curso histórico.");
  const inactiveAdminPage = await fetch(`${baseUrl}/admin/cursos?status=inactive`, { headers: { cookie: cookies.ADMIN } });
  const inactiveAdminHtml = await inactiveAdminPage.text();
  const inactiveCourseTable = inactiveAdminHtml.match(/<table class="data course-admin-table">[\s\S]*?<\/table>/)?.[0] ?? "";
  assert(inactiveAdminPage.status === 200 && inactiveCourseTable.includes("Excel Básico para el Trabajo"), "La vista Inactivos no muestra cursos históricos.");
  const relationCountsAfter = await Promise.all(historical.map(async (course) => ({
    enrollments: await prisma.enrollment.count({ where: { courseId: course.id } }),
    messages: await prisma.outboundMessage.count({ where: { enrollment: { courseId: course.id } } }),
    followUps: await prisma.followUp.count({ where: { lead: { courseId: course.id } } }),
    finance: await prisma.enrollment.count({ where: { courseId: course.id, financeStatus: { not: "NO_ENVIADO" } } }),
    moodle: await prisma.enrollment.count({ where: { courseId: course.id, moodleCompletionDate: { not: null } } }),
  })));
  assert(JSON.stringify(relationCountsAfter) === JSON.stringify(relationCountsBefore), "Las relaciones históricas cambiaron.");
  assert(await prisma.auditLog.count({ where: { action: "COURSE_CATALOG_HISTORICAL_DEACTIVATED", entityId: { in: historical.map((course) => course.id) } } }) === 2, "No se auditó cada desactivación histórica.");

  const secondImport = await expectStatus("/api/admin/courses/catalog", 200, {
    method: "POST",
    body: JSON.stringify({ confirm: "IMPORTAR_CATALOGO_OFICIAL" }),
  }, cookies.ADMIN);
  assert(secondImport.data?.changes?.created === 0, "La segunda importación creó duplicados.");
  assert(secondImport.data?.changes?.updated === 0, "La segunda importación actualizó cursos sin cambios.");
  assert(secondImport.data?.changes?.deactivated === 0, "La segunda importación volvió a desactivar históricos.");
  assert(await prisma.course.count() === 13, "La segunda importación alteró el total de 13 cursos.");

  await expectStatus("/api/leads", 404, {
    method: "POST",
    body: JSON.stringify({
      firstName: "Contacto",
      lastName: "Inactivo",
      email: `inactive-${suffix}@example.test`,
      phone: publicPhone,
      courseSlug: historicalSlugs[0],
      consent: true,
      website: "",
      formStartedAt: Date.now() - 2_000,
      idempotencyKey: `inactive-${suffix}`,
    }),
  });
  const activeCapture = await expectStatus("/api/leads", 201, {
    method: "POST",
    body: JSON.stringify({
      firstName: "Contacto",
      lastName: "Activo",
      email: `active-${suffix}@example.test`,
      phone: publicPhone,
      courseSlug: seedCourses[0].slug,
      consent: true,
      utmSource: "catalog-smoke",
      utmCampaign: "catalog-import",
      website: "",
      formStartedAt: Date.now() - 2_000,
      idempotencyKey: `active-${suffix}`,
    }),
  });
  const capturedEnrollment = await prisma.enrollment.findUnique({ where: { id: String(activeCapture.data?.interestId) } });
  assert(capturedEnrollment?.status === "INTERESADO", "El formulario no registró un interés.");

  console.log(JSON.stringify({
    ok: true,
    initial: { missing: 11, historical: 2 },
    final: { matching: 11, missing: 0, historicalPreserved: 2, officialActive: 11, historicalActive: 0 },
    idempotentSecondRun: true,
    relationsPreserved: true,
    roleGuards: true,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "La prueba de catálogo falló.");
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
      console.log(JSON.stringify({ cleanup: "ok" }));
    } finally {
      await prisma.$disconnect();
    }
  });
