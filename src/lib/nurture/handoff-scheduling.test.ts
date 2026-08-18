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
 * Handoff humano: que se calla y que no cuando hay un asesor escribiendo.
 *
 * El equilibrio importa en las dos direcciones. Un mensaje comercial encima de
 * una conversacion real hace que el CRM parezca no estar leyendo. Pero callar
 * un recordatorio de acceso deja a alguien sin su clase por haber preguntado
 * una duda, y eso es mucho peor.
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

/** Un operativo y un comercial: lo justo para ver la diferencia. */
const REGLAS = [regla("reminder_24h"), regla("course_follow_up")];

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

describe("sin atención humana", () => {
  it("salen los dos: el operativo y el comercial", async () => {
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toEqual(expect.arrayContaining(["reminder_24h", "course_follow_up"]));
  });

  it("una conversación en AUTOMATION no cambia nada", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "AUTOMATION" });
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toContain("course_follow_up");
  });
});

describe("con atención humana abierta", () => {
  beforeEach(() => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "HUMAN_HANDOFF" });
  });

  it("el recordatorio de sesión SIGUE saliendo", async () => {
    // Es la mitad que importa: quien pregunta una duda no puede quedarse sin
    // el aviso de su propia clase.
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toContain("reminder_24h");
  });

  it("el seguimiento comercial NO sale", async () => {
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).not.toContain("course_follow_up");
  });

  it("se consulta la conversación por el teléfono del contacto", async () => {
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(mocks.prisma.conversation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: TELEFONO } }),
    );
  });

  it("se consulta UNA vez, no una por regla", async () => {
    // Once reglas y una sola respuesta: consultar por regla seria multiplicar
    // la misma pregunta en cada programacion.
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(mocks.prisma.conversation.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("casos en los que no se calla nada", () => {
  it("un contacto sin teléfono ni siquiera consulta la conversación", async () => {
    // Sin telefono no hay conversacion posible. Consultar con `undefined`
    // devolveria la primera fila que hubiera y aplicaria el handoff de otra
    // persona; por eso la consulta se salta por completo.
    //
    // (Estas reglas son de WhatsApp, asi que sin telefono tampoco hay mensajes
    // que programar: el motor no tiene a donde enviarlos.)
    mocks.prisma.enrollment.findUnique.mockResolvedValue(inscripcion(null));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(mocks.prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  it("una atención ya cerrada deja pasar todo otra vez", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "RESOLVED" });
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toContain("course_follow_up");
  });

  it("el handoff de una persona no afecta a otra", async () => {
    // El estado se resuelve por telefono, asi que otra inscripcion con otro
    // numero consulta su propia conversacion.
    mocks.prisma.conversation.findUnique.mockImplementation(async ({ where }: any) => (
      where.phone === TELEFONO ? { state: "HUMAN_HANDOFF" } : null
    ));
    mocks.prisma.enrollment.findUnique.mockResolvedValue(inscripcion("+593988888888"));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(momentosProgramados()).toContain("course_follow_up");
  });
});
