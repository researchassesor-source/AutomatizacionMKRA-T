// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    leadEvent: { findFirst: vi.fn() },
    course: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  rescoreLead: vi.fn(async () => undefined),
  writeAudit: vi.fn(async (_input: { action: string }) => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/scoring", () => ({ rescoreLead: mocks.rescoreLead }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { captureLead, leadInputSchema } from "./leads";

type StoredLead = Record<string, any>;
type StoredEnrollment = Record<string, any>;
type StoredEvent = Record<string, any>;

const courses = [
  { id: "course-one", slug: "curso-uno", isPublished: true, acceptsRegistrations: true },
  { id: "course-two", slug: "curso-dos", isPublished: true, acceptsRegistrations: true },
  { id: "course-closed", slug: "curso-cerrado", isPublished: true, acceptsRegistrations: false },
];
let leads: StoredLead[];
let enrollments: StoredEnrollment[];
let events: StoredEvent[];
let transactionQueue: Promise<unknown>;

function input(overrides: Record<string, unknown> = {}) {
  return leadInputSchema.parse({
    firstName: "Persona",
    lastName: "Ficticia",
    email: "persona@example.test",
    phone: "0982716252",
    courseSlug: "curso-uno",
    consent: true,
    source: "meta",
    utmSource: "facebook",
    utmMedium: "paid_social",
    utmCampaign: "qa_cursos_agosto",
    utmContent: "arte_prueba",
    utmTerm: "docentes",
    landingUrl: "https://ra-training.com/cursos/curso-uno/",
    referrer: "https://facebook.com/",
    website: "",
    formStartedAt: Date.now() - 3000,
    idempotencyKey: "capture_test_0001",
    ...overrides,
  });
}

function includedEvent(idempotencyKey: string) {
  const event = events.find((item) => item.idempotencyKey === idempotencyKey);
  if (!event) return null;
  const lead = leads.find((item) => item.id === event.leadId);
  const enrollment = enrollments.find((item) => item.id === event.enrollmentId);
  const course = courses.find((item) => item.id === enrollment?.courseId);
  return event && lead && enrollment && course
    ? { ...event, lead, enrollment: { ...enrollment, course } }
    : null;
}

beforeEach(() => {
  leads = [];
  enrollments = [];
  events = [];
  transactionQueue = Promise.resolve();
  mocks.writeAudit.mockClear();
  mocks.rescoreLead.mockClear();
  mocks.prisma.leadEvent.findFirst.mockImplementation(({ where }: any) => (
    Promise.resolve(includedEvent(where.idempotencyKey))
  ));
  mocks.prisma.course.findUnique.mockImplementation(({ where }: any) => (
    Promise.resolve(courses.find((course) => course.slug === where.slug) ?? null)
  ));

  const tx = {
    $queryRaw: vi.fn(async () => [{ lock_result: "ok" }]),
    lead: {
      findMany: vi.fn(async ({ where }: any) => leads.filter((lead) => (
        where.OR.some((condition: any) => (
          (condition.phone && lead.phone === condition.phone)
          || (condition.email && lead.email === condition.email)
        ))
      ))),
      create: vi.fn(async ({ data }: any) => {
        const lead = { id: `lead-${leads.length + 1}`, ...data };
        leads.push(lead);
        return lead;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const lead = leads.find((item) => item.id === where.id);
        if (!lead) throw new Error("missing lead");
        Object.assign(lead, data);
        return lead;
      }),
    },
    enrollment: {
      findUnique: vi.fn(async ({ where }: any) => enrollments.find((enrollment) => (
        enrollment.leadId === where.leadId_courseId.leadId
        && enrollment.courseId === where.leadId_courseId.courseId
      )) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const enrollment = { id: `enrollment-${enrollments.length + 1}`, ...data };
        enrollments.push(enrollment);
        const course = courses.find((item) => item.id === enrollment.courseId);
        return { ...enrollment, course };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const enrollment = enrollments.find((item) => item.id === where.id);
        if (!enrollment) throw new Error("missing enrollment");
        Object.assign(enrollment, data);
        const course = courses.find((item) => item.id === enrollment.courseId);
        return { ...enrollment, course };
      }),
    },
    leadEvent: {
      create: vi.fn(async ({ data }: any) => {
        const event = { id: `event-${events.length + 1}`, ...data };
        events.push(event);
        return event;
      }),
      createMany: vi.fn(async ({ data }: any) => {
        events.push(...data.map((item: any) => ({ id: `event-${events.length + 1}`, ...item })));
        return { count: data.length };
      }),
    },
  };
  mocks.prisma.$transaction.mockImplementation((callback: any) => {
    const run = transactionQueue.then(() => callback(tx));
    transactionQueue = run.then(() => undefined, () => undefined);
    return run;
  });
});

describe("captura transaccional de contactos", () => {
  it("crea contacto, inscripcion INTERESADO, atribucion y eventos", async () => {
    const result = await captureLead(input(), { requestId: "request-new" });
    expect(result).toMatchObject({ created: true, enrollmentCreated: true, duplicate: false });
    expect(leads).toHaveLength(1);
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]).toMatchObject({
      status: "INTERESADO",
      source: "meta",
      utmSource: "facebook",
      utmMedium: "paid_social",
      utmCampaign: "qa_cursos_agosto",
      utmContent: "arte_prueba",
      utmTerm: "docentes",
      landingUrl: "https://ra-training.com/cursos/curso-uno/",
      referrer: "https://facebook.com/",
    });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "form_submit",
      "CONTACT_CREATED",
      "ENROLLMENT_CREATED",
      "CONSENT_RECORDED",
      "FORM_SUBMIT_SUCCESS",
    ]));
    expect(mocks.writeAudit.mock.calls.map(([audit]) => audit.action)).toEqual(expect.arrayContaining([
      "CONTACT_CREATED",
      "ENROLLMENT_CREATED",
      "CONSENT_RECORDED",
      "FORM_SUBMIT_SUCCESS",
    ]));
  });

  it("reutiliza mismo contacto y curso sin degradar un estado avanzado", async () => {
    await captureLead(input(), { requestId: "request-first" });
    enrollments[0].status = "COMPLETADO";
    const result = await captureLead(input({ idempotencyKey: "capture_test_0002" }), { requestId: "request-again" });
    expect(result).toMatchObject({ created: false, enrollmentCreated: false, duplicate: true });
    expect(result.message).toContain("Ya ten\u00edamos registrado tu inter\u00e9s");
    expect(leads).toHaveLength(1);
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].status).toBe("COMPLETADO");
    expect(events.map((event) => event.type)).toContain("CONTACT_DEDUPLICATED");
  });

  it("mantiene un contacto con dos inscripciones para dos cursos", async () => {
    await captureLead(input(), { requestId: "request-course-one" });
    const result = await captureLead(input({
      courseSlug: "curso-dos",
      idempotencyKey: "capture_test_0003",
    }), { requestId: "request-course-two" });
    expect(result).toMatchObject({ created: false, enrollmentCreated: true, duplicate: false });
    expect(leads).toHaveLength(1);
    expect(enrollments.map((item) => item.courseId)).toEqual(["course-one", "course-two"]);
  });

  it("deduplica por telefono o correo y actualiza la identidad", async () => {
    await captureLead(input(), { requestId: "request-original" });
    await captureLead(input({
      email: "nuevo@example.test",
      idempotencyKey: "capture_test_0004",
    }), { requestId: "request-same-phone" });
    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe("nuevo@example.test");

    await captureLead(input({
      email: "nuevo@example.test",
      phone: "0991111111",
      idempotencyKey: "capture_test_0005",
    }), { requestId: "request-same-email" });
    expect(leads).toHaveLength(1);
    expect(leads[0].phone).toBe("+593991111111");
  });

  it("bloquea cuando correo y telefono pertenecen a contactos distintos", async () => {
    leads.push(
      { id: "lead-email", email: "email@example.test", phone: "+593981111111" },
      { id: "lead-phone", email: "phone@example.test", phone: "+593982716252" },
    );
    await expect(captureLead(input({ email: "email@example.test" }), { requestId: "request-conflict" }))
      .rejects.toThrow("CONTACT_IDENTITY_CONFLICT");
    expect(leads).toHaveLength(2);
  });

  it("hace idempotente la misma clave", async () => {
    const first = await captureLead(input(), { requestId: "request-idempotent-one" });
    const second = await captureLead(input(), { requestId: "request-idempotent-two" });
    expect(second).toMatchObject({ idempotent: true, duplicate: true });
    expect(second.lead.id).toBe(first.lead.id);
    expect(leads).toHaveLength(1);
    expect(enrollments).toHaveLength(1);
  });

  it("rechaza curso inexistente, cerrado o no publicado", async () => {
    await expect(captureLead(input({ courseSlug: "no-existe" }), { requestId: "request-missing" }))
      .rejects.toThrow("COURSE_NOT_FOUND");
    await expect(captureLead(input({ courseSlug: "curso-cerrado" }), { requestId: "request-closed" }))
      .rejects.toThrow("COURSE_UNAVAILABLE");
    courses[2].isPublished = false;
    await expect(captureLead(input({ courseSlug: "curso-cerrado" }), { requestId: "request-unpublished" }))
      .rejects.toThrow("COURSE_UNAVAILABLE");
    courses[2].isPublished = true;
  });

  it("serializa multiples formularios concurrentes para una identidad", async () => {
    const captures = await Promise.all(Array.from({ length: 8 }, (_, index) => captureLead(input({
      idempotencyKey: `capture_parallel_${index}`,
    }), { requestId: `request-parallel-${index}` })));
    expect(captures).toHaveLength(8);
    expect(leads).toHaveLength(1);
    expect(enrollments).toHaveLength(1);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(8);
    expect(mocks.prisma.$transaction.mock.calls[0]?.[1]).toMatchObject({ isolationLevel: "ReadCommitted" });
  });
});
