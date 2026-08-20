// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    enrollment: { findUnique: vi.fn() },
    outboundMessage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    conversation: { findUnique: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { scheduleEnrollmentAutomations } from "./engine";
import { DEFAULT_AUTOMATION_PLAN } from "./default-automations";
import { WHATSAPP_AUTOMATION_PLAN, templateFieldsFor } from "./default-automations-whatsapp";

/**
 * Diagnóstico puro, sin cambios en engine.ts.
 *
 * El incidente reportado ("Falta el enlace de la reunión") es fail-closed
 * correcto, no un bug. Pero la pregunta real es si ESE gate (requiresStreamUrl)
 * está bien calibrado por canal: EMAIL y WhatsApp son AutomationRule
 * independientes para el mismo planKey y pueden declarar requiresStreamUrl
 * distinto porque sus plantillas dicen cosas distintas. Este archivo prueba,
 * para una MISMA sesión sin enlace, qué pasa exactamente en cada combinación
 * — usando los planes reales, no una copia de sus valores.
 */
const SESSION_START = new Date("2026-08-08T00:30:00.000Z");
const NOW = new Date("2026-08-06T15:00:00.000Z");

type StoredMessage = Record<string, any>;
let messages: StoredMessage[];

function identityOf(message: StoredMessage) {
  return `${message.leadId}|${message.enrollmentId}|${message.sequenceKey}|${message.stepKey}`;
}

function planEntry(planKey: string) {
  const entry = DEFAULT_AUTOMATION_PLAN.find((item) => item.planKey === planKey);
  if (!entry) throw new Error(`El plan de correo ya no incluye ${planKey}.`);
  return entry;
}

function whatsappEntry(planKey: string) {
  const entry = WHATSAPP_AUTOMATION_PLAN.find((item) => item.planKey === planKey);
  if (!entry) throw new Error(`El plan de WhatsApp ya no incluye ${planKey}.`);
  return entry;
}

/** Regla EMAIL construida a partir del plan real, no de valores inventados. */
function emailRule(planKey: string) {
  const entry = planEntry(planKey);
  return {
    id: `rule-email-${planKey}`,
    planKey: entry.planKey,
    courseId: "course-matrix",
    campaignId: null,
    trigger: entry.trigger,
    offsetMinutes: entry.offsetMinutes,
    channel: "EMAIL" as const,
    subject: entry.subject,
    body: entry.body,
    status: "ACTIVE" as const,
    requiresStreamUrl: entry.requiresStreamUrl,
    enrollmentStatuses: entry.enrollmentStatuses,
  };
}

/** Regla WHATSAPP construida a partir del plan real de WhatsApp, con su plantilla real enlazada. */
function whatsappRule(planKey: string) {
  const entry = whatsappEntry(planKey);
  const template = templateFieldsFor(entry);
  return {
    id: `rule-whatsapp-${planKey}`,
    planKey: entry.planKey,
    courseId: "course-matrix",
    campaignId: null,
    trigger: entry.trigger,
    offsetMinutes: entry.offsetMinutes,
    channel: "WHATSAPP" as const,
    subject: null,
    body: entry.body,
    status: "ACTIVE" as const,
    requiresStreamUrl: entry.requiresStreamUrl,
    enrollmentStatuses: entry.enrollmentStatuses,
    ...template,
  };
}

function enrollment(rules: unknown[]) {
  return {
    id: "enrollment-matrix",
    leadId: "lead-matrix",
    courseId: "course-matrix",
    campaignId: null,
    status: "INSCRITO",
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    lead: {
      id: "lead-matrix", firstName: "QA", lastName: "Matrix", fullName: "QA Matrix",
      email: "qa.matrix@example.test", phone: "+593987000000",
      classification: "REAL", consent: true, assignedToId: "admin-1",
    },
    course: {
      id: "course-matrix",
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
      // El curso NO tiene enlace propio: solo lo tendría la sesión, y tampoco.
      streamUrl: null,
      sessions: [{ id: "session-matrix", title: null, startAt: SESSION_START, endAt: null, streamUrl: null }],
      automationRules: rules,
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
  mocks.prisma.conversation.findUnique.mockResolvedValue(null);
});

async function schedule(rule: unknown) {
  mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment([rule]));
  await scheduleEnrollmentAutomations("enrollment-matrix", NOW);
  return messages[0];
}

describe("matriz canal × requiresStreamUrl, misma sesión futura sin enlace", () => {
  it("reminder_24h EMAIL: se programa sin streamUrl (requiresStreamUrl=false en el plan de correo)", async () => {
    expect(planEntry("reminder_24h").requiresStreamUrl).toBe(false);
    const message = await schedule(emailRule("reminder_24h"));
    expect(message.status).toBe("PROGRAMADO");
  });

  it("reminder_24h WHATSAPP: también se programa sin streamUrl (requiresStreamUrl=false en el plan de WhatsApp)", async () => {
    expect(whatsappEntry("reminder_24h").requiresStreamUrl).toBe(false);
    const message = await schedule(whatsappRule("reminder_24h"));
    expect(message.status).toBe("PROGRAMADO");
  });

  it("reminder_2h EMAIL: bloqueado sin streamUrl, tal como exige su contrato actual (requiresStreamUrl=true)", async () => {
    expect(planEntry("reminder_2h").requiresStreamUrl).toBe(true);
    const message = await schedule(emailRule("reminder_2h"));
    expect(message.status).toBe("OMITIDO");
    expect(message.errorCode).toBe("MISSING_STREAM_URL");
  });

  it("reminder_2h WHATSAPP: NO se bloquea por streamUrl -- la plantilla Meta de 2h no lleva enlace", async () => {
    expect(whatsappEntry("reminder_2h").requiresStreamUrl).toBe(false);
    const message = await schedule(whatsappRule("reminder_2h"));
    expect(message.status).toBe("PROGRAMADO");
    expect(message.errorCode).toBeNull();
  });

  it("reminder_15m EMAIL: bloqueado sin streamUrl", async () => {
    const message = await schedule(emailRule("reminder_15m"));
    expect(message.status).toBe("OMITIDO");
    expect(message.errorCode).toBe("MISSING_STREAM_URL");
  });

  it("reminder_15m WHATSAPP: también bloqueado sin streamUrl -- su plantilla sí lleva el enlace", async () => {
    expect(whatsappEntry("reminder_15m").requiresStreamUrl).toBe(true);
    const message = await schedule(whatsappRule("reminder_15m"));
    expect(message.status).toBe("OMITIDO");
    expect(message.errorCode).toBe("MISSING_STREAM_URL");
  });
});

describe("otras causas por las que una regla de WhatsApp puede quedar fuera (confirmadas, no asumidas)", () => {
  it("sin ninguna regla activa para el curso: NO_ACTIVE_RULES", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment([]));
    const result = await scheduleEnrollmentAutomations("enrollment-matrix", NOW);
    expect(result.reason).toBe("NO_ACTIVE_RULES");
  });

  it("regla PAUSED: se filtra igual que si no existiera, no genera mensaje", async () => {
    const rule = { ...whatsappRule("reminder_24h"), status: "PAUSED" };
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment([rule]));
    const result = await scheduleEnrollmentAutomations("enrollment-matrix", NOW);
    expect(result.reason).toBe("NO_ACTIVE_RULES");
    expect(messages).toHaveLength(0);
  });

  it("HUMAN_HANDOFF activo: un momento comercial se salta (welcome no es operativo)", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValueOnce({ state: "HUMAN_HANDOFF" });
    const message = await schedule(emailRule("welcome"));
    expect(message).toBeUndefined();
  });

  it("contacto sin teléfono: una regla de WhatsApp no tiene a dónde enviarse", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue({
      ...enrollment([whatsappRule("reminder_24h")]),
      lead: { ...enrollment([]).lead, phone: null },
    });
    await scheduleEnrollmentAutomations("enrollment-matrix", NOW);
    expect(messages).toHaveLength(0);
  });

  it("contacto sin consentimiento: CONTACT_EXCLUDED", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue({
      ...enrollment([whatsappRule("reminder_24h")]),
      lead: { ...enrollment([]).lead, consent: false },
    });
    const result = await scheduleEnrollmentAutomations("enrollment-matrix", NOW);
    expect(result.reason).toBe("CONTACT_EXCLUDED");
  });
});
