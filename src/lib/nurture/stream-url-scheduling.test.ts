// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    enrollment: { findUnique: vi.fn(), findMany: vi.fn() },
    outboundMessage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    courseSession: { findMany: vi.fn() },
    conversation: { findUnique: vi.fn(async () => null) },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { rescheduleCourseAutomations, scheduleEnrollmentAutomations } from "./engine";
import { DEFAULT_AUTOMATION_PLAN } from "./default-automations";

/**
 * Hallazgo de producción: mensajes "No entregado" con "Falta el enlace de la
 * reunión…". Eso demuestra que el scheduler y el fail-closed funcionan; la
 * causa es Course/Session sin streamUrl, no un bug de engine.ts. Esta prueba
 * fija ese comportamiento tal como está, sin tocar la lógica.
 */
const REMINDER_15M = DEFAULT_AUTOMATION_PLAN.find((entry) => entry.planKey === "reminder_15m");
if (!REMINDER_15M) throw new Error("El plan estándar ya no incluye reminder_15m.");
// Objeto plano (no la referencia narrowed): TS no propaga el narrowing de un
// const de módulo dentro de funciones definidas más abajo que se llaman después.
const REMINDER_15M_DEFAULTS = {
  planKey: REMINDER_15M.planKey,
  trigger: REMINDER_15M.trigger,
  offsetMinutes: REMINDER_15M.offsetMinutes,
  subject: REMINDER_15M.subject,
  body: REMINDER_15M.body,
  requiresStreamUrl: REMINDER_15M.requiresStreamUrl,
  enrollmentStatuses: REMINDER_15M.enrollmentStatuses,
};

const SESSION_START = new Date("2026-08-08T00:30:00.000Z");
const SESSION_END = new Date("2026-08-08T01:30:00.000Z");
const REMINDER_SCHEDULED_AT = "2026-08-08T00:15:00.000Z";

type StoredMessage = Record<string, any>;
let messages: StoredMessage[];

function identityOf(message: StoredMessage) {
  return `${message.leadId}|${message.enrollmentId}|${message.sequenceKey}|${message.stepKey}`;
}

function rule() {
  return {
    id: "rule-reminder-15m",
    planKey: REMINDER_15M_DEFAULTS.planKey,
    courseId: "course-stream",
    campaignId: null,
    trigger: REMINDER_15M_DEFAULTS.trigger,
    offsetMinutes: REMINDER_15M_DEFAULTS.offsetMinutes,
    channel: "EMAIL" as const,
    subject: REMINDER_15M_DEFAULTS.subject,
    body: REMINDER_15M_DEFAULTS.body,
    status: "ACTIVE" as const,
    requiresStreamUrl: REMINDER_15M_DEFAULTS.requiresStreamUrl,
    enrollmentStatuses: REMINDER_15M_DEFAULTS.enrollmentStatuses,
  };
}

function enrollment(streamUrl: string | null) {
  return {
    id: "enrollment-stream",
    leadId: "lead-stream",
    courseId: "course-stream",
    campaignId: null,
    status: "INSCRITO",
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    lead: {
      id: "lead-stream", firstName: "QA", lastName: "Stream", fullName: "QA Stream",
      email: "qa.stream@example.test", phone: "+593987654322",
      classification: "REAL", consent: true, assignedToId: "admin-1",
    },
    course: {
      id: "course-stream",
      title: "Curso con Sesión en Vivo",
      officialCourseUrl: "https://ra-training.com/courses-1/",
      courseCompleteUrl: null,
      whatsappGroupUrl: null,
      surveyUrl: null,
      moodleCourseUrl: null,
      modality: "Virtual",
      isPublished: true,
      isFree: true,
      acceptsRegistrations: true,
      startsAt: null,
      endsAt: null,
      streamUrl,
      sessions: [{ id: "session-stream", title: null, startAt: SESSION_START, endAt: SESSION_END, streamUrl: null }],
      automationRules: [rule()],
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
  mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "session-stream" }]);
});

function reminder() {
  return messages.find((message) => message.sequenceKey === "automation:EMAIL:reminder_15m");
}

describe("regresión: enlace de transmisión faltante (hallazgo de producción)", () => {
  it("sin streamUrl, el recordatorio de 15 minutos se omite con MISSING_STREAM_URL", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment(null));
    const result = await scheduleEnrollmentAutomations("enrollment-stream", new Date("2026-08-06T15:00:00.000Z"));

    expect(result.omitted).toBe(1);
    expect(reminder()?.status).toBe("OMITIDO");
    expect(reminder()?.errorCode).toBe("MISSING_STREAM_URL");
    expect(reminder()?.errorMessage).toBe("La sesión no tiene un enlace de transmisión configurado.");
  });

  it("al configurar streamUrl, rescheduleCourseAutomations reprograma el recordatorio futuro", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment(null));
    await scheduleEnrollmentAutomations("enrollment-stream", new Date("2026-08-06T15:00:00.000Z"));
    expect(reminder()?.status).toBe("OMITIDO");

    // Se configura el enlace y se recalcula el curso, todavía antes de la sesión.
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment("https://meet.example.com/stream"));
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-stream" }]).mockResolvedValue([]);
    const result = await rescheduleCourseAutomations("course-stream", new Date("2026-08-07T00:00:00.000Z"));

    expect(result.updated).toBe(1);
    expect(reminder()?.status).toBe("PROGRAMADO");
    expect(reminder()?.errorCode).toBeNull();
    expect(reminder()?.scheduledAt.toISOString()).toBe(REMINDER_SCHEDULED_AT);
  });

  it("un recordatorio ya vencido NO revive aunque se configure streamUrl después", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment(null));
    await scheduleEnrollmentAutomations("enrollment-stream", new Date("2026-08-06T15:00:00.000Z"));
    expect(reminder()?.status).toBe("OMITIDO");

    // El enlace se configura, pero solo DESPUÉS de que el recordatorio ya venció.
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment("https://meet.example.com/stream"));
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-stream" }]).mockResolvedValue([]);
    const result = await rescheduleCourseAutomations("course-stream", new Date("2026-08-08T00:20:00.000Z"));

    expect(result.updated).toBe(0);
    expect(reminder()?.status).toBe("OMITIDO");
    expect(reminder()?.errorCode).toBe("MISSING_STREAM_URL");
  });
});
