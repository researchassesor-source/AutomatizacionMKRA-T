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

import { rescheduleCourseAutomations, renderMessageTemplate, scheduleEnrollmentAutomations } from "./engine";
import { DEFAULT_AUTOMATION_PLAN } from "./default-automations";
import { WHATSAPP_AUTOMATION_PLAN } from "./default-automations-whatsapp";

type StoredMessage = Record<string, any>;

const NOW = new Date("2026-08-06T12:00:00.000Z");
let messages: StoredMessage[];

function identityOf(message: StoredMessage) {
  return `${message.leadId}|${message.enrollmentId}|${message.sequenceKey}|${message.stepKey}`;
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-before",
    courseId: "course-1",
    campaignId: null,
    trigger: "BEFORE_COURSE",
    offsetMinutes: 1440,
    channel: "EMAIL",
    subject: "Mañana nos vemos en {{curso}}",
    body: "Hola {{nombre}}, la sesión {{sesion}} es el {{fechaSesion}} a las {{horaSesion}}.\n\n{{bloqueEnlace}}",
    status: "ACTIVE",
    requiresStreamUrl: false,
    enrollmentStatuses: ["INTERESADO", "INSCRITO"],
    ...overrides,
  };
}

function enrollment(overrides: { sessions?: any[]; rules?: any[]; streamUrl?: string | null; startsAt?: Date | null; status?: string } = {}) {
  return {
    id: "enrollment-1",
    leadId: "lead-1",
    courseId: "course-1",
    campaignId: null,
    status: overrides.status ?? "INSCRITO",
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    lead: { id: "lead-1", firstName: "Ana", lastName: "Pérez", fullName: "Ana Pérez", email: "ana@example.test", phone: "+593987654321", classification: "REAL", consent: true, assignedToId: null },
    course: {
      id: "course-1",
      title: "Taller de prueba",
      officialCourseUrl: "https://ra-training.com/courses-1/",
      moodleCourseUrl: null,
      modality: "Virtual",
      isPublished: true,
      // Taller gratuito: el derecho de acceso lo concede el registro.
      isFree: true,
      acceptsRegistrations: true,
      startsAt: overrides.startsAt === undefined ? new Date("2026-08-20T14:00:00.000Z") : overrides.startsAt,
      endsAt: null,
      streamUrl: overrides.streamUrl === undefined ? "https://meet.example.com/sala" : overrides.streamUrl,
      sessions: overrides.sessions ?? [],
      automationRules: overrides.rules ?? [rule()],
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
  mocks.prisma.courseSession.findMany.mockResolvedValue([]);
});

describe("programación de recordatorios por sesión", () => {
  it("INTERESADO programa comunicaciones sin esperar a INSCRITO", async () => {
    const welcome = [rule({ id: "rule-welcome", trigger: "ON_REGISTRATION", offsetMinutes: 0 })];
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ status: "INTERESADO", rules: welcome }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.enqueued).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].scheduledAt).toEqual(new Date("2026-08-01T12:00:00.000Z"));
  });

  it("la transición INTERESADO a INSCRITO reutiliza las mismas claves y no duplica", async () => {
    const welcome = [rule({ id: "rule-welcome", trigger: "ON_REGISTRATION", offsetMinutes: 0 })];
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ status: "INTERESADO", rules: welcome }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    const originalId = messages[0].id;
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ status: "INSCRITO", rules: welcome }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(originalId);
  });

  it("calcula 24h, 2h y 15min desde una sesión real de 19:30 en Ecuador", async () => {
    const session = { id: "s-1930", title: null, startAt: new Date("2026-08-12T00:30:00.000Z"), endAt: null, streamUrl: "https://meet.example.com/sala" };
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [session],
      rules: [
        rule({ id: "rule-24h", offsetMinutes: 1440 }),
        rule({ id: "rule-2h", offsetMinutes: 120 }),
        rule({ id: "rule-15m", offsetMinutes: 15 }),
      ],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", new Date("2026-08-10T12:00:00.000Z"));
    expect(messages.map((message) => message.scheduledAt.toISOString())).toEqual([
      "2026-08-11T00:30:00.000Z",
      "2026-08-11T22:30:00.000Z",
      "2026-08-12T00:15:00.000Z",
    ]);
    const localTimes = messages.map((message) => new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" }).format(message.scheduledAt).replace(/[\u00a0\u202f]/g, " "));
    expect(localTimes).toEqual(["7:30 p. m.", "5:30 p. m.", "7:15 p. m."]);
  });

  it("omite el recordatorio vencido y conserva solo los momentos futuros", async () => {
    const session = { id: "s-hoy", title: null, startAt: new Date("2026-08-12T00:30:00.000Z"), endAt: null, streamUrl: "https://meet.example.com/sala" };
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      status: "INTERESADO",
      sessions: [session],
      rules: [
        rule({ id: "rule-24h", offsetMinutes: 1440 }),
        rule({ id: "rule-2h", offsetMinutes: 120 }),
        rule({ id: "rule-15m", offsetMinutes: 15 }),
      ],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", new Date("2026-08-11T17:47:00.000Z"));
    expect(messages.map((message) => message.sequenceKey)).toEqual(["automation:EMAIL:rule-2h", "automation:EMAIL:rule-15m"]);
  });

  it("correo y WhatsApp comparten trigger, offset y audiencia temporal", () => {
    for (const emailRule of DEFAULT_AUTOMATION_PLAN) {
      const whatsappRule = WHATSAPP_AUTOMATION_PLAN.find((item) => item.planKey === emailRule.planKey);
      expect(whatsappRule).toMatchObject({
        trigger: emailRule.trigger,
        offsetMinutes: emailRule.offsetMinutes,
        enrollmentStatuses: emailRule.enrollmentStatuses,
      });
    }
  });

  it("CANCELADO nunca recibe mensajes aunque una regla no limite estados", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      status: "CANCELADO",
      rules: [rule({ enrollmentStatuses: [] })],
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.reason).toBe("ENROLLMENT_CANCELLED");
    expect(messages).toHaveLength(0);
  });

  it("un curso con una sola fecha conserva la clave idempotente histórica", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.enqueued).toBe(1);
    expect(messages[0].stepKey).toBe("enrollment:enrollment-1");
    expect(messages[0].scheduledAt.toISOString()).toBe("2026-08-19T14:00:00.000Z");
    expect(messages[0].courseSessionId).toBeNull();
  });

  it("genera un recordatorio por cada sesión con clave propia", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [
        { id: "s1", title: null, startAt: new Date("2026-08-20T14:00:00.000Z"), endAt: null, streamUrl: null },
        { id: "s2", title: null, startAt: new Date("2026-08-27T14:00:00.000Z"), endAt: null, streamUrl: null },
      ],
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.enqueued).toBe(2);
    expect(messages.map((message) => message.stepKey)).toEqual([
      "enrollment:enrollment-1:session:s1",
      "enrollment:enrollment-1:session:s2",
    ]);
    expect(messages.map((message) => message.courseSessionId)).toEqual(["s1", "s2"]);
  });

  it("no duplica al repetir la programación", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [{ id: "s1", title: null, startAt: new Date("2026-08-20T14:00:00.000Z"), endAt: null, streamUrl: null }],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    const second = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(1);
    expect(second.enqueued).toBe(0);
  });

  it("omite las sesiones que ya ocurrieron", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [
        { id: "pasada", title: null, startAt: new Date("2026-08-02T14:00:00.000Z"), endAt: null, streamUrl: null },
        { id: "futura", title: null, startAt: new Date("2026-08-27T14:00:00.000Z"), endAt: null, streamUrl: null },
      ],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages.map((message) => message.courseSessionId)).toEqual(["futura"]);
  });

  it("el agradecimiento se programa una sola vez, tras la última sesión", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      rules: [rule({ id: "rule-thanks", trigger: "AFTER_COURSE", offsetMinutes: 60, subject: "Gracias", body: "Gracias {{nombre}}" })],
      sessions: [
        { id: "s1", title: null, startAt: new Date("2026-08-20T14:00:00.000Z"), endAt: new Date("2026-08-20T16:00:00.000Z"), streamUrl: null },
        { id: "s2", title: null, startAt: new Date("2026-08-27T14:00:00.000Z"), endAt: new Date("2026-08-27T16:00:00.000Z"), streamUrl: null },
      ],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(1);
    expect(messages[0].scheduledAt.toISOString()).toBe("2026-08-27T17:00:00.000Z");
    expect(messages[0].stepKey).toBe("enrollment:enrollment-1");
  });

  it("la bienvenida se programa al inscribirse aunque el curso no tenga fecha", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      rules: [rule({ id: "rule-welcome", trigger: "ON_REGISTRATION", offsetMinutes: 0, subject: "Bienvenida", body: "Hola {{nombre}}" })],
      startsAt: null,
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.enqueued).toBe(1);
    expect(messages[0].scheduledAt.toISOString()).toBe("2026-08-01T12:00:00.000Z");
  });

  it("registra el recordatorio de 15 minutos como omitido cuando falta el enlace", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      rules: [rule({ id: "rule-15m", offsetMinutes: 15, requiresStreamUrl: true, body: "Ingresa: {{streamUrl}}" })],
      streamUrl: null,
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.omitted).toBe(1);
    expect(messages[0].status).toBe("OMITIDO");
    expect(messages[0].errorCode).toBe("MISSING_STREAM_URL");
    expect(messages[0].errorMessage).toContain("enlace de transmisión");
  });

  it("reactiva el recordatorio omitido cuando aparece el enlace", async () => {
    const rules = [rule({ id: "rule-15m", offsetMinutes: 15, requiresStreamUrl: true, body: "Ingresa: {{streamUrl}}" })];
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules, streamUrl: null }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules, streamUrl: "https://meet.example.com/sala" }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe("PROGRAMADO");
    expect(messages[0].body).toContain("https://meet.example.com/sala");
  });

  it("actualiza la fecha del mensaje pendiente al cambiar la sesión", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [{ id: "s1", title: null, startAt: new Date("2026-08-20T14:00:00.000Z"), endAt: null, streamUrl: null }],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [{ id: "s1", title: null, startAt: new Date("2026-08-25T14:00:00.000Z"), endAt: null, streamUrl: null }],
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.updated).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].scheduledAt.toISOString()).toBe("2026-08-24T14:00:00.000Z");
  });

  it("nunca reescribe un mensaje que ya salió", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    messages[0].status = "ACEPTADO";
    const scheduledAt = messages[0].scheduledAt;
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ startsAt: new Date("2026-08-25T14:00:00.000Z") }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.updated).toBe(0);
    expect(messages[0].scheduledAt).toBe(scheduledAt);
    expect(messages[0].status).toBe("ACEPTADO");
  });

  it("excluye contactos de prueba y sin consentimiento", async () => {
    const base = enrollment();
    mocks.prisma.enrollment.findUnique.mockResolvedValue({ ...base, lead: { ...base.lead, classification: "TEST" } });
    expect((await scheduleEnrollmentAutomations("enrollment-1", NOW)).reason).toBe("CONTACT_EXCLUDED");
    mocks.prisma.enrollment.findUnique.mockResolvedValue({ ...base, lead: { ...base.lead, consent: false } });
    expect((await scheduleEnrollmentAutomations("enrollment-1", NOW)).reason).toBe("CONTACT_EXCLUDED");
    expect(messages).toHaveLength(0);
  });

  it("cancela los recordatorios de sesiones eliminadas al recalcular el curso", async () => {
    mocks.prisma.enrollment.findMany.mockResolvedValue([]);
    mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1" }]);
    mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 3 });
    const result = await rescheduleCourseAutomations("course-1", NOW);
    expect(result.cancelled).toBe(3);
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELADO", errorCode: "SESSION_REMOVED" }) }),
    );
  });
});

describe("variables de plantilla", () => {
  it("colapsa los huecos que deja un bloque vacío", () => {
    expect(renderMessageTemplate("Hola\n\n{{bloqueEnlace}}\n\nGracias", { bloqueEnlace: "" })).toBe("Hola\n\nGracias");
  });

  it("omite el bloque de fecha en lugar de escribir «por confirmar» dos veces", () => {
    expect(renderMessageTemplate("Hola\n\n{{bloqueFecha}}\n\nGracias", { bloqueFecha: "" })).toBe("Hola\n\nGracias");
  });

  it("no reemplaza variables desconocidas", () => {
    expect(renderMessageTemplate("{{tokenSecreto}}", {})).toBe("{{tokenSecreto}}");
  });

  it("expone el enlace de la sesión en el cuerpo del recordatorio", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [{ id: "s1", title: "Módulo 1", startAt: new Date("2026-08-20T14:00:00.000Z"), endAt: null, streamUrl: "https://zoom.example.com/uno" }],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages[0].body).toContain("Módulo 1");
    expect(messages[0].body).toContain("https://zoom.example.com/uno");
    expect(messages[0].subject).toBe("Mañana nos vemos en Taller de prueba");
  });
});
