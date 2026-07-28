import { PrismaClient, type AdminRole } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();
const baseUrl = "http://localhost:3000";
const password = "Release-only-9x!Qa";
const suffix = Date.now().toString(36);
const emails = ["admin", "marketing", "ventas", "lectura", "inactive"].map((role) => `${role}-${suffix}@example.test`);
const manualEmail = `manual-${suffix}@example.test`;
const publicEmail = `public-${suffix}@example.test`;
const entityIds: string[] = [];
const leadIds: string[] = [];
const courseIds: string[] = [];
const accountIds: string[] = [];
const checks: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`SMOKE_ASSERTION: ${message}`);
}

function assertLocalDatabase() {
  const raw = process.env.POSTGRES_PRISMA_URL ?? "";
  assert(raw, "Falta POSTGRES_PRISMA_URL.");
  const url = new URL(raw);
  assert(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "La prueba solo se permite contra PostgreSQL local.");
}

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: "manual" });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { response, data };
}

async function expectStatus(path: string, status: number, options: RequestInit = {}, cookie?: string) {
  const result = await request(path, options, cookie);
  assert(result.response.status === status, `${path}: esperado ${status}, recibido ${result.response.status}`);
  return result;
}

async function login(email: string) {
  const result = await expectStatus("/api/admin/login", 200, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const cookie = result.response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie, "El login no devolvió cookie de sesión.");
  return cookie;
}

async function createUser(email: string, role: AdminRole, isActive = true) {
  const user = await prisma.adminUser.create({
    data: {
      name: `Usuario ${role} de prueba`,
      email,
      passwordHash: await hashPassword(password),
      role,
      isActive,
    },
  });
  entityIds.push(user.id);
  return user;
}

async function cleanupStaleFixtures() {
  const staleAccounts = await prisma.socialAccount.findMany({
    where: { externalId: { startsWith: "local-" }, displayName: { startsWith: "Cuenta ficticia " } },
    select: { id: true },
  });
  const staleAccountIds = staleAccounts.map((item) => item.id);
  if (staleAccountIds.length) {
    await prisma.socialPost.deleteMany({ where: { accountId: { in: staleAccountIds } } });
    await prisma.socialSchedule.deleteMany({ where: { accountId: { in: staleAccountIds } } });
    await prisma.socialAccount.deleteMany({ where: { id: { in: staleAccountIds } } });
  }
  await prisma.lead.deleteMany({
    where: {
      email: { endsWith: "@example.test" },
      OR: [{ source: "release-smoke" }, { utmSource: "release-smoke" }],
    },
  });
  await prisma.course.deleteMany({ where: { category: "Prueba local", enrollments: { none: {} } } });
  const staleActors = await prisma.adminUser.findMany({
    where: { email: { endsWith: "@example.test" }, name: { startsWith: "Usuario ", endsWith: " de prueba" } },
    select: { id: true, email: true },
  });
  if (staleActors.length) {
    await prisma.auditLog.deleteMany({ where: { actorEmail: { in: staleActors.map((item) => item.email) } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: staleActors.map((item) => item.id) } } });
  }
}

async function main() {
  assertLocalDatabase();
  await cleanupStaleFixtures();
  const existingCourses = await prisma.course.findMany({ where: { isPublished: true }, select: { id: true, slug: true }, take: 2 });
  assert(existingCourses.length >= 1, "Se necesita al menos un curso local publicado.");

  await expectStatus("/api/admin/login", 401, {
    method: "POST",
    body: JSON.stringify({ email: emails[0], password: "incorrecta-local" }),
  });
  const admin = await createUser(emails[0], "ADMIN");
  await createUser(emails[1], "MARKETING");
  await createUser(emails[2], "VENTAS");
  await createUser(emails[3], "LECTURA");
  const inactive = await createUser(emails[4], "LECTURA");
  const adminCookie = await login(admin.email);
  const me = await expectStatus("/api/admin/me", 200, {}, adminCookie);
  assert(me.data?.role === "ADMIN", "La sesión individual no conservó el rol ADMIN.");
  checks.push("auth-individual");

  const coursePayload = {
    slug: `release-smoke-${suffix}`,
    title: "Curso ficticio de validación",
    subtitle: "Uso exclusivo en prueba local",
    description: "Registro temporal retirado al finalizar.",
    category: "Prueba local",
    officialCourseUrl: "https://ra-training.com/courses-1/",
    moodleCourseUrl: "",
    imageUrl: "",
    price: 10,
    duration: "1 hora",
    isFree: false,
    isPublished: true,
    isLeadMagnet: false,
    hasCertificate: true,
    displayOrder: 9999,
  };
  await expectStatus("/api/admin/courses", 422, {
    method: "POST",
    body: JSON.stringify({ ...coursePayload, slug: `invalid-${suffix}`, officialCourseUrl: "https://example.test/course" }),
  }, adminCookie);
  const createdCourse = await expectStatus("/api/admin/courses", 201, {
    method: "POST",
    body: JSON.stringify(coursePayload),
  }, adminCookie);
  const courseId = String((createdCourse.data?.course as { id?: string })?.id ?? "");
  assert(courseId, "No se devolvió el curso creado.");
  courseIds.push(courseId);
  entityIds.push(courseId);
  await expectStatus(`/api/admin/courses/${courseId}`, 200, {
    method: "PATCH",
    body: JSON.stringify({ ...coursePayload, title: "Curso ficticio de validación editado" }),
  }, adminCookie);
  checks.push("course-crud-validation");

  const manual = await expectStatus("/api/admin/leads", 201, {
    method: "POST",
    body: JSON.stringify({
      fullName: "Contacto Manual Ficticio",
      phone: "0990000001",
      email: manualEmail,
      courseId,
      source: "release-smoke",
      assignedToId: admin.id,
      consent: true,
    }),
  }, adminCookie);
  const manualLeadId = String(manual.data?.id ?? "");
  assert(manualLeadId, "No se devolvió el contacto manual.");
  leadIds.push(manualLeadId);
  entityIds.push(manualLeadId);
  assert(await prisma.enrollment.count({ where: { leadId: manualLeadId } }) === 0, "El contacto manual creó una inscripción implícita.");

  const firstEnrollment = await expectStatus("/api/admin/enrollments", 201, {
    method: "POST",
    body: JSON.stringify({ leadId: manualLeadId, courseId, status: "INSCRITO" }),
  }, adminCookie);
  const enrollmentOneId = String(firstEnrollment.data?.enrollmentId ?? "");
  entityIds.push(enrollmentOneId);
  await expectStatus("/api/admin/enrollments", 409, {
    method: "POST",
    body: JSON.stringify({ leadId: manualLeadId, courseId, status: "INSCRITO" }),
  }, adminCookie);
  const secondEnrollment = await expectStatus("/api/admin/enrollments", 201, {
    method: "POST",
    body: JSON.stringify({ leadId: manualLeadId, courseId: existingCourses[0].id, status: "INSCRITO" }),
  }, adminCookie);
  const enrollmentTwoId = String(secondEnrollment.data?.enrollmentId ?? "");
  entityIds.push(enrollmentTwoId);
  assert(await prisma.enrollment.count({ where: { leadId: manualLeadId } }) === 2, "No se conservaron dos inscripciones independientes.");

  await expectStatus(`/api/admin/leads/${manualLeadId}`, 200, {
    method: "PATCH",
    body: JSON.stringify({ firstName: "Contacto", lastName: "Ficticio", nextActionAt: "2026-08-01T14:00:00.000Z" }),
  }, adminCookie);
  await expectStatus(`/api/admin/leads/${manualLeadId}/notes`, 201, {
    method: "POST",
    body: JSON.stringify({ content: "Nota ficticia de validación local." }),
  }, adminCookie);
  const follow = await expectStatus(`/api/admin/leads/${manualLeadId}/followups`, 201, {
    method: "POST",
    body: JSON.stringify({ type: "WHATSAPP", dueAt: "2026-08-01T15:00:00.000Z", notes: "Seguimiento ficticio" }),
  }, adminCookie);
  const followId = String((follow.data?.followUp as { id?: string })?.id ?? "");
  entityIds.push(followId);
  await expectStatus(`/api/admin/followups/${followId}`, 200, {
    method: "PATCH",
    body: JSON.stringify({ status: "COMPLETADO" }),
  }, adminCookie);
  await expectStatus("/api/admin/leads/stage", 200, {
    method: "POST",
    body: JSON.stringify({ leadId: manualLeadId, stage: "OPORTUNIDAD" }),
  }, adminCookie);
  await expectStatus(`/api/admin/leads/${manualLeadId}`, 200, { method: "PATCH", body: JSON.stringify({ isArchived: true }) }, adminCookie);
  await expectStatus(`/api/admin/leads/${manualLeadId}`, 200, { method: "PATCH", body: JSON.stringify({ isArchived: false }) }, adminCookie);
  await expectStatus(`/api/admin/leads/${manualLeadId}`, 409, {
    method: "DELETE",
    body: JSON.stringify({ confirmName: "Contacto Ficticio" }),
  }, adminCookie);
  checks.push("contacts-enrollments-notes-followups-archive");

  const publicInput = {
    firstName: "Persona",
    lastName: "Pública Ficticia",
    email: publicEmail,
    phone: "0990000002",
    courseSlug: coursePayload.slug,
    consent: true,
    formStartedAt: Date.now() - 5000,
    idempotencyKey: `smoke_${suffix}_one`,
    website: "",
    utmSource: "release-smoke",
    utmMedium: "local",
    utmCampaign: "rc-validation",
  };
  const publicCreated = await expectStatus("/api/leads", 201, { method: "POST", body: JSON.stringify(publicInput) });
  const publicLeadId = String(publicCreated.data?.leadId ?? "");
  leadIds.push(publicLeadId);
  entityIds.push(publicLeadId, String(publicCreated.data?.enrollmentId ?? ""));
  await expectStatus("/api/leads", 200, { method: "POST", body: JSON.stringify({ ...publicInput, formStartedAt: Date.now() - 5000 }) });
  await expectStatus("/api/leads", 200, {
    method: "POST",
    body: JSON.stringify({ ...publicInput, courseSlug: existingCourses[0].slug, idempotencyKey: `smoke_${suffix}_two`, formStartedAt: Date.now() - 5000 }),
  });
  assert(await prisma.enrollment.count({ where: { leadId: publicLeadId } }) === 2, "La captura pública no separó las inscripciones por curso.");
  checks.push("public-capture-idempotency");

  await expectStatus("/api/moodle/completion", 401, {
    method: "POST",
    body: JSON.stringify({ eventId: `moodle-${suffix}`, enrollmentId: enrollmentOneId, email: manualEmail, courseSlug: coursePayload.slug }),
  });
  const moodleBody = { eventId: `moodle-${suffix}`, enrollmentId: enrollmentOneId, email: manualEmail, courseSlug: coursePayload.slug, moodleEnrollmentId: `moodle-local-${suffix}` };
  await expectStatus("/api/moodle/completion", 200, {
    method: "POST",
    headers: { "x-moodle-webhook-secret": "local-release-smoke-only" },
    body: JSON.stringify(moodleBody),
  });
  const duplicateMoodle = await expectStatus("/api/moodle/completion", 200, {
    method: "POST",
    headers: { "x-moodle-webhook-secret": "local-release-smoke-only" },
    body: JSON.stringify(moodleBody),
  });
  assert(duplicateMoodle.data?.duplicate === true, "Moodle no reconoció el evento repetido.");
  const financeFirst = await expectStatus(`/api/admin/enrollments/${enrollmentTwoId}/complete`, 200, { method: "POST" }, adminCookie);
  assert(financeFirst.data?.simulated === true, "Finance no permaneció simulado.");
  const financeRepeat = await expectStatus(`/api/admin/enrollments/${enrollmentTwoId}/complete`, 200, { method: "POST" }, adminCookie);
  assert(financeRepeat.data?.reused === true, "El handoff simulado no fue idempotente.");
  checks.push("moodle-finance-idempotency");

  const message = await prisma.outboundMessage.create({
    data: { leadId: manualLeadId, enrollmentId: enrollmentTwoId, channel: "EMAIL", toAddress: manualEmail, body: "Mensaje ficticio", status: "SIMULADO", scheduledAt: new Date() },
  });
  entityIds.push(message.id);
  const retried = await expectStatus(`/api/admin/messages/${message.id}`, 200, {
    method: "PATCH",
    body: JSON.stringify({ action: "retry" }),
  }, adminCookie);
  assert(retried.data?.simulated === true, "La mensajería local intentó salir del modo simulado.");
  const cancellable = await prisma.outboundMessage.create({
    data: { leadId: manualLeadId, enrollmentId: enrollmentTwoId, channel: "EMAIL", toAddress: manualEmail, body: "Mensaje cancelable", status: "PROGRAMADO", scheduledAt: new Date(Date.now() + 60_000) },
  });
  entityIds.push(cancellable.id);
  await expectStatus(`/api/admin/messages/${cancellable.id}`, 200, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) }, adminCookie);
  checks.push("messaging-simulation-cancel-retry");

  const socialAccount = await expectStatus("/api/admin/social/accounts", 201, {
    method: "POST",
    body: JSON.stringify({ platform: "FACEBOOK", displayName: `Cuenta ficticia ${suffix}`, externalId: `local-${suffix}` }),
  }, adminCookie);
  const accountId = String(socialAccount.data?.accountId ?? "");
  accountIds.push(accountId);
  entityIds.push(accountId);
  await expectStatus("/api/admin/social/accounts", 422, {
    method: "POST",
    body: JSON.stringify({ platform: "YOUTUBE", displayName: "Sin conector" }),
  }, adminCookie);
  const post = await expectStatus("/api/admin/social/posts", 201, {
    method: "POST",
    body: JSON.stringify({ accountId, caption: "Publicación ficticia", mediaUrl: "", linkUrl: "", scheduledAt: "" }),
  }, adminCookie);
  const postId = String(post.data?.postId ?? "");
  entityIds.push(postId);
  const duplicatePost = await expectStatus(`/api/admin/social/posts/${postId}`, 200, { method: "PATCH", body: JSON.stringify({ action: "duplicate" }) }, adminCookie);
  entityIds.push(String(duplicatePost.data?.postId ?? ""));
  const published = await expectStatus("/api/admin/social/publish", 200, { method: "POST", body: JSON.stringify({ postId }) }, adminCookie);
  assert(published.data?.simulated === true, "La publicación local no permaneció simulada.");
  await expectStatus(`/api/admin/social/posts/${postId}`, 200, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) }, adminCookie);
  const schedule = await expectStatus("/api/admin/social/schedules", 201, {
    method: "POST",
    body: JSON.stringify({ accountId, name: "Recurrencia ficticia", caption: "Contenido ficticio", mediaUrl: "", linkUrl: "", weekday: 2, localTime: "09:30" }),
  }, adminCookie);
  entityIds.push(String((schedule.data?.schedule as { id?: string })?.id ?? ""));
  await expectStatus(`/api/admin/social/accounts/${accountId}`, 200, { method: "DELETE" }, adminCookie);
  checks.push("social-simulation-connectors-schedule");

  const marketingCookie = await login(emails[1]);
  await expectStatus("/api/admin/courses", 200, {}, marketingCookie);
  await expectStatus("/api/admin/leads", 403, { method: "POST", body: JSON.stringify({}) }, marketingCookie);
  const ventasCookie = await login(emails[2]);
  await expectStatus("/api/admin/social/accounts", 403, { method: "POST", body: JSON.stringify({}) }, ventasCookie);
  const lecturaCookie = await login(emails[3]);
  await expectStatus("/api/admin/courses", 200, {}, lecturaCookie);
  await expectStatus("/api/admin/leads/export", 403, {}, lecturaCookie);
  const inactiveCookie = await login(emails[4]);
  await prisma.adminUser.update({ where: { id: inactive.id }, data: { isActive: false } });
  await expectStatus("/api/admin/me", 401, {}, inactiveCookie);
  checks.push("role-matrix-session-revocation");

  for (const path of ["/admin", "/admin/leads", "/admin/cursos", "/admin/seguimientos", "/admin/ventas", "/admin/mensajes", "/admin/redes", "/admin/certificados", "/admin/usuarios", "/admin/auditoria"]) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: adminCookie }, redirect: "manual" });
    assert(response.status === 200, `${path}: no respondió 200.`);
  }
  await expectStatus("/api/nurture/dispatch", 401, { method: "POST", headers: { authorization: "Bearer incorrecto" } });
  await expectStatus("/api/social/publish", 401, { method: "POST", headers: { authorization: "Bearer incorrecto" } });
  await expectStatus(`/api/admin/courses/${courseId}`, 200, { method: "DELETE" }, adminCookie);
  const logout = await expectStatus("/api/admin/logout", 200, { method: "POST" }, adminCookie);
  assert((logout.response.headers.get("set-cookie") ?? "").toLowerCase().includes("max-age=0"), "Logout no invalidó la cookie.");
  checks.push("route-health-cron-guard-logout");

  console.log(JSON.stringify({ ok: true, checks, fixtureCounts: { users: emails.length, leads: leadIds.length, courses: courseIds.length, socialAccounts: accountIds.length } }, null, 2));
}

async function cleanup() {
  try {
    if (accountIds.length) {
      await prisma.socialPost.deleteMany({ where: { accountId: { in: accountIds } } });
      await prisma.socialSchedule.deleteMany({ where: { accountId: { in: accountIds } } });
      await prisma.socialAccount.deleteMany({ where: { id: { in: accountIds } } });
    }
    if (leadIds.length) {
      await prisma.outboundMessage.deleteMany({ where: { leadId: { in: leadIds } } });
      await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    }
    await prisma.lead.deleteMany({ where: { email: { in: [manualEmail, publicEmail] } } });
    if (courseIds.length) await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorEmail: { in: emails } }, { entityId: { in: entityIds.filter(Boolean) } }] } });
    await prisma.adminUser.deleteMany({ where: { email: { in: emails } } });
    const residue = await Promise.all([
      prisma.adminUser.count({ where: { email: { in: emails } } }),
      prisma.lead.count({ where: { email: { in: [manualEmail, publicEmail] } } }),
      prisma.course.count({ where: { id: { in: courseIds } } }),
      prisma.socialAccount.count({ where: { id: { in: accountIds } } }),
    ]);
    assert(residue.every((count) => count === 0), "La limpieza dejó fixtures locales.");
    console.log(JSON.stringify({ cleanup: "ok" }));
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "La prueba local falló.");
    process.exitCode = 1;
  })
  .finally(cleanup);
