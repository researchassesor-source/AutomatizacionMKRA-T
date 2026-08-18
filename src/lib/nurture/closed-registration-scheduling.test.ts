// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    enrollment: { findUnique: vi.fn(), findMany: vi.fn() },
    outboundMessage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    courseSession: { findMany: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { describeScheduleResult, rescheduleCourseAutomations, scheduleEnrollmentAutomations } from "./engine";
import { DEFAULT_AUTOMATION_PLAN } from "./default-automations";

/**
 * Momentos que recibe una inscripcion en un curso de UNA sola sesion.
 *
 * Son diez y no once: el cierre de sesion anuncia cuando es la siguiente ("La
 * siguiente sesión está programada para..."), asi que en un curso de una sesion
 * no tiene nada que decir y no se programa. El cierre del curso lo cubren
 * `course_complete` y `survey`.
 */
const MOMENTOS_UNA_SESION = 10;

/** Caso QA: hoy 6 de agosto; la sesión es el 7 de agosto 19:30 Guayaquil. */
const NOW = new Date("2026-08-06T15:00:00.000Z");
const SESSION_START = new Date("2026-08-08T00:30:00.000Z"); // 7 ago 19:30 en Guayaquil
const SESSION_END = new Date("2026-08-08T01:30:00.000Z");

type StoredMessage = Record<string, any>;
let messages: StoredMessage[];

function identityOf(message: StoredMessage) {
  return `${message.leadId}|${message.enrollmentId}|${message.sequenceKey}|${message.stepKey}`;
}

/** Las cinco reglas del plan estándar, activas. */
function planRules() {
  return DEFAULT_AUTOMATION_PLAN.map((entry) => ({
    id: `rule-${entry.planKey}`,
    planKey: entry.planKey,
    courseId: "course-marketing",
    campaignId: null,
    trigger: entry.trigger,
    offsetMinutes: entry.offsetMinutes,
    channel: "EMAIL" as const,
    subject: entry.subject,
    body: entry.body,
    status: "ACTIVE" as const,
    requiresStreamUrl: entry.requiresStreamUrl,
    enrollmentStatuses: entry.enrollmentStatuses,
  }));
}

function enrollment(overrides: {
  acceptsRegistrations?: boolean;
  isPublished?: boolean;
  sessions?: any[];
  rules?: any[];
  status?: string;
} = {}) {
  return {
    id: "enrollment-qa",
    leadId: "lead-qa",
    courseId: "course-marketing",
    campaignId: null,
    status: overrides.status ?? "INSCRITO",
    createdAt: new Date("2026-08-05T12:00:00.000Z"),
    lead: {
      id: "lead-qa", firstName: "QA", lastName: "Preview", fullName: "QA PREVIEW FINAL",
      email: "qa.preview@example.test", phone: "+593987654321",
      classification: "REAL", consent: true, assignedToId: "admin-1",
    },
    course: {
      id: "course-marketing",
      title: "Desarrollo Profesional en Marketing",
      officialCourseUrl: "https://ra-training.com/courses-1/",
      courseCompleteUrl: "https://ra-training.com/curso-completo",
      whatsappGroupUrl: "https://chat.whatsapp.com/qa",
      surveyUrl: "https://forms.example.com/encuesta",
      moodleCourseUrl: null,
      modality: "Virtual",
      isPublished: overrides.isPublished ?? true,
      // El caso reproducido: registro CERRADO.
      acceptsRegistrations: overrides.acceptsRegistrations ?? false,
      startsAt: null,
      endsAt: null,
      streamUrl: "https://meet.example.com/marketing",
      sessions: overrides.sessions ?? [
        { id: "session-7ago", title: null, startAt: SESSION_START, endAt: SESSION_END, streamUrl: null },
      ],
      automationRules: overrides.rules ?? planRules(),
    },
  };
}

beforeEach(() => {
  messages = [];
  mocks.prisma.outboundMessage.findUnique.mockImplementation(async ({ where }: any) => {
    const key = where.leadId_enrollmentId_sequenceKey_stepKey;
    return messages.find((message) => identityOf(message) === identityOf(key)) ?? null;
  });
  mocks.prisma.outboundMessage.create.mockImplementation(async ({ data }: any) => {
    const created = { id: `message-${messages.length + 1}`, ...data };
    messages.push(created);
    return created;
  });
  mocks.prisma.outboundMessage.update.mockImplementation(async ({ where, data }: any) => {
    const target = messages.find((message) => message.id === where.id);
    if (!target) throw new Error(`Mensaje inexistente: ${where.id}`);
    Object.assign(target, data);
    return target;
  });
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "session-7ago" }]);
});

describe("regresión: curso con registro cerrado", () => {
  it("programa los cinco mensajes de una inscripción existente", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    const result = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(result.reason).toBeUndefined();
    expect(result.enqueued).toBe(MOMENTOS_UNA_SESION);
    expect(messages).toHaveLength(MOMENTOS_UNA_SESION);
  });

  it("incluye bienvenida, los tres recordatorios y el agradecimiento", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    const byRule = messages.map((message) => message.sequenceKey).sort();
    expect(byRule).toEqual([
      "automation:EMAIL:course_complete",
      "automation:EMAIL:course_follow_up",
      "automation:EMAIL:late_access",
      "automation:EMAIL:reminder_15m",
      "automation:EMAIL:reminder_24h",
      "automation:EMAIL:reminder_2h",
      "automation:EMAIL:session_live",
      "automation:EMAIL:survey",
      "automation:EMAIL:welcome",
      "automation:EMAIL:whatsapp_group",
    ]);
  });

  it("el recordatorio de 15 minutos hereda el enlace del curso", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    const reminder = messages.find((message) => message.sequenceKey === "automation:EMAIL:reminder_15m");
    expect(reminder).toBeDefined();
    expect(reminder?.status).toBe("PROGRAMADO");
    expect(reminder?.body).toContain("https://meet.example.com/marketing");
    expect(reminder?.scheduledAt.toISOString()).toBe("2026-08-08T00:15:00.000Z");
  });

  it("también funciona con el registro abierto", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ acceptsRegistrations: true }));
    const result = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(result.enqueued).toBe(MOMENTOS_UNA_SESION);
  });

  it("un curso despublicado sí detiene la programación", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ isPublished: false }));
    const result = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(result.reason).toBe("COURSE_NOT_PUBLISHED");
    expect(messages).toHaveLength(0);
  });

  it("una sesión pasada no genera recordatorios atrasados", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [{ id: "session-vieja", title: null, startAt: new Date("2026-07-01T00:30:00.000Z"), endAt: new Date("2026-07-01T01:30:00.000Z"), streamUrl: null }],
    }));
    await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    // Solo sobreviven bienvenida (al inscribirse) y agradecimiento; los tres
    // recordatorios previos a la sesión ya no tienen sentido.
    const keys = messages.map((message) => message.sequenceKey).sort();
    expect(keys).toEqual(["automation:EMAIL:welcome", "automation:EMAIL:whatsapp_group"]);
  });

  it("guardar la sesión dos veces no duplica mensajes", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    const second = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(messages).toHaveLength(MOMENTOS_UNA_SESION);
    expect(second.enqueued).toBe(0);
  });
});

describe("motivo visible cuando no se genera nada", () => {
  it("informa que el curso no tiene automatizaciones activas", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules: [] }));
    const result = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(result.reason).toBe("NO_ACTIVE_RULES");
    expect(describeScheduleResult(result)).toContain("plan estándar");
  });

  it("informa y audita cuando hay reglas activas pero ninguna aplica", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      status: "COMPLETADO",
      rules: planRules().map((rule) => ({ ...rule, enrollmentStatuses: ["INSCRITO"] })),
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(result.reason).toBe("ENROLLMENT_COMPLETED");
    expect(describeScheduleResult(result)).toContain("finalizo");
  });

  it("informa que el contacto está excluido", async () => {
    const base = enrollment();
    mocks.prisma.enrollment.findUnique.mockResolvedValue({ ...base, lead: { ...base.lead, consent: false } });
    const result = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(result.reason).toBe("CONTACT_EXCLUDED");
    expect(describeScheduleResult(result)).toContain("consentimiento");
  });

  it("no devuelve advertencia cuando sí se programó", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    const result = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(describeScheduleResult(result)).toBeNull();
  });
});

describe("plan estándar sobre inscripciones anteriores", () => {
  it("reprograma una inscripción creada antes de aplicar el plan", async () => {
    // La inscripción ya existía y el curso no tenía reglas: no había mensajes.
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules: [] }));
    const before = await scheduleEnrollmentAutomations("enrollment-qa", NOW);
    expect(before.reason).toBe("NO_ACTIVE_RULES");
    expect(messages).toHaveLength(0);

    // Se aplica el plan estándar y se reprograma el curso completo.
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-qa" }]).mockResolvedValue([]);
    const result = await rescheduleCourseAutomations("course-marketing", NOW);

    expect(result.enrollments).toBe(1);
    expect(result.enqueued).toBe(MOMENTOS_UNA_SESION);
    expect(messages).toHaveLength(MOMENTOS_UNA_SESION);
  });

  it("reaplicar el plan no duplica los mensajes existentes", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-qa" }]).mockResolvedValue([]);
    await rescheduleCourseAutomations("course-marketing", NOW);
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-qa" }]).mockResolvedValue([]);
    const second = await rescheduleCourseAutomations("course-marketing", NOW);

    expect(messages).toHaveLength(MOMENTOS_UNA_SESION);
    expect(second.enqueued).toBe(0);
  });
});
