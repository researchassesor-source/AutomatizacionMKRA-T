// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    enrollment: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    outboundMessage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    courseSession: { findMany: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    conversation: { findUnique: vi.fn() },
    leadEvent: { create: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { scheduleEnrollmentAutomations } from "./engine";
import { WHATSAPP_AUTOMATION_PLAN, templateFieldsFor } from "./default-automations-whatsapp";

/**
 * Cierre de producción: atención humana y automatizaciones coexisten.
 *
 * Antes, un asesor escribiendo callaba lo comercial de esa persona
 * (HUMAN_HANDOFF gateaba `scheduleEnrollmentAutomations`). Es una decisión de
 * producto revertida deliberadamente: un humano puede atender en cualquier
 * momento sin pausar el journey, comercial u operativo.
 * `scheduleEnrollmentAutomations` ya ni siquiera consulta la conversación del
 * contacto — no hay ninguna decisión que tomar sobre ese estado aquí. Ver el
 * comentario de cabecera de `conversation.ts`. El mock de `conversation`
 * sigue declarado a propósito: varias pruebas lo dejan devolviendo
 * HUMAN_HANDOFF para demostrar que, aunque lo hiciera, no cambiaría nada.
 */
const NOW = new Date("2026-08-20T15:00:00.000Z");
const SESION = new Date("2026-08-25T00:30:00.000Z");
const TELEFONO = "+593999999999";

function regla(planKey: string) {
  const entry = WHATSAPP_AUTOMATION_PLAN.find((item) => item.planKey === planKey);
  if (!entry) throw new Error(`Entrada inexistente: ${planKey}`);
  return {
    id: `wa-${planKey}`,
    courseId: "course-1",
    campaignId: null,
    planKey,
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
  };
}

/** Un operativo, un comercial y un conversacional: los tres deben salir siempre. */
const REGLAS = [regla("reminder_24h"), regla("course_follow_up"), regla("welcome")];

function inscripcion(telefono: string | null = TELEFONO) {
  return {
    id: "enrollment-1",
    leadId: "lead-1",
    courseId: "course-1",
    campaignId: null,
    status: "INSCRITO",
    createdAt: new Date("2026-08-10T00:00:00.000Z"),
    purchases: [],
    lead: {
      id: "lead-1", firstName: "Ana", lastName: "Pérez", fullName: "Ana Pérez",
      email: "ana@example.test", phone: telefono,
      classification: "REAL", consent: true, assignedToId: null,
    },
    course: {
      id: "course-1",
      title: "Taller gratuito",
      officialCourseUrl: "https://ra-training.com/cursos/taller/",
      moodleCourseUrl: null,
      modality: "Virtual",
      isPublished: true,
      isFree: true,
      automationsPausedAt: null,
      acceptsRegistrations: true,
      startsAt: null,
      endsAt: null,
      streamUrl: "https://meet.google.com/abc-defg-hij",
      courseCompleteUrl: "https://ra-training.com/completo",
      whatsappGroupUrl: null,
      surveyUrl: null,
      sessions: [{ id: "s1", title: null, startAt: SESION, endAt: null, streamUrl: "https://meet.google.com/abc-defg-hij" }],
      automationRules: REGLAS,
    },
  };
}

let mensajes: Record<string, any>[];

/** Momentos efectivamente programados, por su clave de plan. */
function momentosProgramados() {
  return mensajes.map((m) => String(m.sequenceKey).split(":").pop());
}

beforeEach(() => {
  mensajes = [];
  mocks.prisma.enrollment.findUnique.mockResolvedValue(inscripcion());
  mocks.prisma.conversation.findUnique.mockResolvedValue(null);
  mocks.prisma.outboundMessage.findUnique.mockResolvedValue(null);
  mocks.prisma.outboundMessage.create.mockImplementation(async ({ data }: any) => {
    mensajes.push({ id: `msg-${mensajes.length + 1}`, ...data });
    return data;
  });
  mocks.prisma.outboundMessage.update.mockResolvedValue({});
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1" }]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.prisma.leadEvent.create.mockResolvedValue({});
});

describe("HUMAN_HANDOFF nunca calla una automatización al programar", () => {
  it("sin conversación conocida, salen el operativo, el comercial y el conversacional", async () => {
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toEqual(expect.arrayContaining(["reminder_24h", "course_follow_up", "welcome"]));
  });

  it("ya no consulta la conversación del contacto: no hay handoff que evaluar aquí", async () => {
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(mocks.prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  it("aunque la conversación esté en HUMAN_HANDOFF, el operativo sigue saliendo (como siempre)", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "HUMAN_HANDOFF" });
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toContain("reminder_24h");
  });

  it("aunque la conversación esté en HUMAN_HANDOFF, el comercial y lo conversacional TAMBIÉN salen (cambio deliberado)", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "HUMAN_HANDOFF" });
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toEqual(expect.arrayContaining(["course_follow_up", "welcome"]));
  });

  it("una conversación en AUTOMATION o RESOLVED tampoco cambia nada", async () => {
    for (const state of ["AUTOMATION", "RESOLVED"]) {
      mensajes = [];
      mocks.prisma.conversation.findUnique.mockResolvedValue({ state });
      await scheduleEnrollmentAutomations("enrollment-1", NOW);
      expect(momentosProgramados()).toContain("course_follow_up");
    }
  });

  it("un contacto sin teléfono simplemente no tiene a dónde mandar los de WhatsApp", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(inscripcion(null));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toEqual([]);
    expect(mocks.prisma.conversation.findUnique).not.toHaveBeenCalled();
  });
});
