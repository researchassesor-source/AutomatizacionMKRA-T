// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

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

import { rescheduleCourseAutomations, scheduleEnrollmentAutomations } from "./engine";
import { templateFieldsFor, WHATSAPP_AUTOMATION_PLAN } from "./default-automations-whatsapp";

const NOW = new Date("2026-08-06T15:00:00.000Z");
const REGISTERED_AT = new Date("2026-08-06T14:30:00.000Z");
const SESSION_START = new Date("2026-08-08T00:30:00.000Z");

let messages: Record<string, any>[];

function waRule(planKey: string, overrides: Record<string, any> = {}) {
  const entry = WHATSAPP_AUTOMATION_PLAN.find((item) => item.planKey === planKey);
  if (!entry) throw new Error(`Entrada inexistente: ${planKey}`);
  return {
    id: `wa-${planKey}`,
    courseId: "course-1",
    campaignId: null,
    trigger: entry.trigger,
    offsetMinutes: entry.offsetMinutes,
    channel: "WHATSAPP" as const,
    subject: null,
    body: entry.body,
    status: "ACTIVE" as const,
    requiresStreamUrl: entry.requiresStreamUrl,
    enrollmentStatuses: entry.enrollmentStatuses,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...templateFieldsFor(entry),
    ...overrides,
  };
}

function enrollment(overrides: { rules?: any[]; streamUrl?: string | null; sessions?: any[] } = {}) {
  return {
    id: "enrollment-1",
    leadId: "lead-1",
    courseId: "course-1",
    campaignId: null,
    status: "INSCRITO",
    createdAt: REGISTERED_AT,
    lead: {
      id: "lead-1", firstName: "Angel", lastName: "Prueba", fullName: "Angel Prueba",
      email: "angel@example.test", phone: "+593999999999",
      classification: "REAL", consent: true, assignedToId: null,
    },
    course: {
      id: "course-1",
      title: "IA para Apoyo en Tareas Académicas",
      officialCourseUrl: "https://ra-training.com/cursos/ia/",
      moodleCourseUrl: null,
      modality: "Virtual",
      isPublished: true,
      acceptsRegistrations: true,
      startsAt: null,
      endsAt: null,
      streamUrl: null,
      sessions: overrides.sessions ?? [{
        id: "s1", title: null, startAt: SESSION_START, endAt: null,
        streamUrl: overrides.streamUrl === undefined ? "https://meet.google.com/abc-defg-hij" : overrides.streamUrl,
      }],
      automationRules: overrides.rules ?? [waRule("welcome")],
    },
  };
}

function identityOf(message: Record<string, any>) {
  return `${message.leadId}|${message.enrollmentId}|${message.sequenceKey}|${message.stepKey}`;
}

beforeEach(() => {
  messages = [];
  mocks.prisma.outboundMessage.findUnique.mockImplementation(async ({ where }: any) => {
    const key = where.leadId_enrollmentId_sequenceKey_stepKey;
    const identity = `${key.leadId}|${key.enrollmentId}|${key.sequenceKey}|${key.stepKey}`;
    return messages.find((item) => identityOf(item) === identity) ?? null;
  });
  mocks.prisma.outboundMessage.create.mockImplementation(async ({ data }: any) => {
    messages.push({ id: `msg-${messages.length + 1}`, ...data });
    return data;
  });
  mocks.prisma.outboundMessage.update.mockImplementation(async ({ where, data }: any) => {
    const target = messages.find((item) => item.id === where.id);
    if (target) Object.assign(target, data);
    return target;
  });
  mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1" }]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
});

describe("programación de WhatsApp con plantillas", () => {
  it("guarda en el mensaje la plantilla ya resuelta, no solo su nombre", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(1);
    expect(messages[0].waTemplate).toMatchObject({
      name: "ra_training_bienvenida_inscripcion",
      language: "es",
    });
    const parametros = messages[0].waTemplate.components[0].parameters;
    // El orden es el que espera Meta: {{1}} nombre, {{2}} curso, {{3}} fecha,
    // {{4}} hora, {{5}} numero de sesion y {{6}} total de sesiones.
    expect(parametros[0]).toEqual({ type: "text", text: "Angel" });
    expect(parametros[1]).toEqual({ type: "text", text: "IA para Apoyo en Tareas Académicas" });
    // Numeros sueltos: el texto ya escribe "Sesión {{5}} de {{6}}" alrededor.
    expect(parametros[4]).toEqual({ type: "text", text: "1" });
    expect(parametros[5]).toEqual({ type: "text", text: "1" });
    expect(parametros).toHaveLength(6);
  });

  it("una regla de WhatsApp sin plantilla produce OMITIDO, nunca un mensaje de texto", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      rules: [waRule("welcome", { waTemplateName: null })],
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.omitted).toBe(1);
    expect(messages[0].status).toBe("OMITIDO");
    expect(messages[0].errorCode).toBe("WHATSAPP_TEMPLATE_MISSING");
    // Sin plantilla resuelta no se guarda ninguna: la columna queda a NULL.
    expect(messages[0].waTemplate).toEqual(Prisma.DbNull);
  });

  it("el aviso de 15 minutos se omite sin enlace en lugar de mandar un parámetro vacío", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      rules: [waRule("reminder_15m")],
      streamUrl: null,
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.omitted).toBe(1);
    expect(messages[0]).toMatchObject({ status: "OMITIDO", errorCode: "MISSING_STREAM_URL" });
  });

  it("con enlace, el aviso de 15 minutos lo lleva como parámetro de la plantilla", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules: [waRule("reminder_15m")] }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    const parametros = messages[0].waTemplate.components[0].parameters;
    expect(parametros.at(-1)).toEqual({ type: "text", text: "https://meet.google.com/abc-defg-hij" });
  });

  it("correo y WhatsApp del mismo paso conviven sin pisarse", async () => {
    const emailRule = { ...waRule("welcome"), id: "email-welcome", channel: "EMAIL" as const, subject: "Asunto", waTemplateName: null };
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules: [emailRule, waRule("welcome")] }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(2);
    // Claves idempotentes distintas: van por `sequenceKey` de cada regla.
    expect(new Set(messages.map(identityOf)).size).toBe(2);
    // El correo guarda DbNull, que Prisma traduce a NULL en la columna.
    expect(messages.find((m) => m.channel === "EMAIL")?.waTemplate).toEqual(Prisma.DbNull);
    expect(messages.find((m) => m.channel === "WHATSAPP")?.waTemplate).toMatchObject({ name: expect.any(String) });
  });
});

describe("idempotencia del plan de WhatsApp", () => {
  it("reprogramar dos veces no duplica mensajes", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-1" }]).mockResolvedValue([]);
    await rescheduleCourseAutomations("course-1", NOW);
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-1" }]).mockResolvedValue([]);
    const segunda = await rescheduleCourseAutomations("course-1", NOW);
    expect(messages).toHaveLength(1);
    expect(segunda.enqueued).toBe(0);
  });

  it("un mensaje ya enviado no se reescribe al reprogramar", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    messages[0].status = "ACEPTADO";
    const plantillaOriginal = messages[0].waTemplate;

    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      rules: [waRule("welcome", { waTemplateName: "ra_training_otra_plantilla" })],
    }));
    const segunda = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(segunda.enqueued).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].waTemplate).toBe(plantillaOriginal);
  });

  it("un mensaje pendiente sí adopta la plantilla corregida", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      rules: [waRule("welcome", { waTemplateName: null })],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages[0].status).toBe("OMITIDO");

    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    const segunda = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(segunda.updated).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ status: "PROGRAMADO" });
    expect(messages[0].waTemplate).toMatchObject({ name: "ra_training_bienvenida_inscripcion" });
  });

  it("mover la sesión reprograma el recordatorio sin duplicarlo", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules: [waRule("reminder_24h")] }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(1);
    const original = messages[0].scheduledAt;

    const movida = new Date(SESSION_START.getTime() + 48 * 3_600_000);
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      rules: [waRule("reminder_24h")],
      sessions: [{ id: "s1", title: null, startAt: movida, endAt: null, streamUrl: "https://meet.google.com/abc-defg-hij" }],
    }));
    const segunda = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(segunda.updated).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].scheduledAt.getTime()).toBeGreaterThan(original.getTime());
  });
});
