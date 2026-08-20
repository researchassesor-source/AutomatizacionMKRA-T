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

import { rescheduleCourseAutomations } from "./engine";

/**
 * Requisito E del reconciliador de calendario: un mensaje ya enviado nunca se
 * reescribe ni se reenvía cuando la sesión asociada cambia de fecha (por
 * ejemplo, porque el admin confirmó un calendario nuevo de WordPress).
 *
 * No es lógica nueva: rescheduleCourseAutomations ya distingue estados
 * reprogramables de finales. Esta prueba fija ese comportamiento en el
 * contexto exacto en que la nueva ruta de reconciliación lo usa: la sesión
 * cambia primero (mismo id, otra fecha), y LUEGO se llama a
 * rescheduleCourseAutomations — igual que hace la ruta.
 */
const ORIGINAL_START = new Date("2026-08-18T00:30:00.000Z");
const NEW_START = new Date("2026-08-26T00:30:00.000Z");
const NOW = new Date("2026-08-10T00:00:00.000Z");

type StoredMessage = Record<string, any>;
let messages: StoredMessage[];

function identityOf(message: StoredMessage) {
  return `${message.leadId}|${message.enrollmentId}|${message.sequenceKey}|${message.stepKey}`;
}

const rule = {
  id: "rule-24h",
  planKey: "reminder_24h",
  courseId: "course-reprog",
  campaignId: null,
  trigger: "BEFORE_COURSE" as const,
  offsetMinutes: 1440,
  channel: "EMAIL" as const,
  subject: "Recordatorio",
  body: "Hola {{nombre}}, tu sesión es el {{fechaSesion}}.",
  status: "ACTIVE" as const,
  requiresStreamUrl: false,
  enrollmentStatuses: ["INTERESADO", "INSCRITO", "EN_CURSO"] as const,
};

function enrollment(sessionStart: Date) {
  return {
    id: "enrollment-reprog",
    leadId: "lead-reprog",
    courseId: "course-reprog",
    campaignId: null,
    status: "INSCRITO",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    lead: {
      id: "lead-reprog", firstName: "QA", lastName: "Reprog", fullName: "QA Reprog",
      email: "qa.reprog@example.test", phone: "+593987000001",
      classification: "REAL", consent: true, assignedToId: "admin-1",
    },
    course: {
      id: "course-reprog",
      title: "Curso Reprogramable",
      officialCourseUrl: "https://ra-training.com/courses-1/",
      courseCompleteUrl: null, whatsappGroupUrl: null, surveyUrl: null, moodleCourseUrl: null,
      modality: "Virtual",
      isPublished: true,
      isFree: true,
      acceptsRegistrations: true,
      startsAt: null,
      endsAt: null,
      streamUrl: "https://meet.example.com/reprog",
      sessions: [{ id: "session-reprog", title: null, startAt: sessionStart, endAt: null, streamUrl: null }],
      automationRules: [rule],
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
  mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "session-reprog" }]);
});

describe("E: un mensaje ya enviado nunca se reescribe cuando la sesión cambia de fecha", () => {
  it("ENVIADO se conserva intacto; el PROGRAMADO de otro contacto sí se reprograma", async () => {
    // Estado antes del cambio de calendario: un mensaje real ya salió.
    messages.push({
      id: "message-ya-enviado",
      leadId: "lead-reprog",
      enrollmentId: "enrollment-reprog",
      courseSessionId: "session-reprog",
      sequenceKey: "automation:EMAIL:reminder_24h",
      // Formato real de scheduleTargets para BEFORE_COURSE con sesión real:
      // `enrollment:{enrollmentId}:session:{session.key}`, y session.key es el
      // id de CourseSession. No es el planKey.
      stepKey: "enrollment:enrollment-reprog:session:session-reprog",
      status: "ENVIADO",
      scheduledAt: new Date(ORIGINAL_START.getTime() - 24 * 60 * 60_000),
      sentAt: new Date("2026-08-16T20:00:00.000Z"),
      providerMessageId: "smtp-real-123",
      body: "Hola Ana, tu sesión es el 17 de agosto.",
      errorCode: null,
      errorMessage: null,
    });
    const snapshotAntes = { ...messages[0] };

    // La ruta de reconciliación ya actualizó la sesión (mismo id, fecha nueva)
    // y ahora llama a rescheduleCourseAutomations, exactamente en este orden.
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment(NEW_START));
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-reprog" }]).mockResolvedValue([]);
    const result = await rescheduleCourseAutomations("course-reprog", NOW);

    const mensajeEnviado = messages.find((m) => m.id === "message-ya-enviado");
    expect(mensajeEnviado).toEqual(snapshotAntes);
    expect(mensajeEnviado?.status).toBe("ENVIADO");
    expect(mensajeEnviado?.providerMessageId).toBe("smtp-real-123");
    // El enviado reclamó la identidad del paso: no se creó un segundo mensaje,
    // y no hubo ni creación ni actualización para esta regla.
    expect(messages).toHaveLength(1);
    expect(result.enqueued).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("en cambio, un PROGRAMADO para el mismo paso sí se mueve a la fecha nueva", async () => {
    messages.push({
      id: "message-pendiente",
      leadId: "lead-reprog",
      enrollmentId: "enrollment-reprog",
      courseSessionId: "session-reprog",
      sequenceKey: "automation:EMAIL:reminder_24h",
      stepKey: "enrollment:enrollment-reprog:session:session-reprog",
      status: "PROGRAMADO",
      scheduledAt: new Date(ORIGINAL_START.getTime() - 24 * 60 * 60_000),
      errorCode: null,
      errorMessage: null,
    });

    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment(NEW_START));
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-reprog" }]).mockResolvedValue([]);
    await rescheduleCourseAutomations("course-reprog", NOW);

    const pendiente = messages.find((m) => m.id === "message-pendiente");
    expect(pendiente?.status).toBe("PROGRAMADO");
    expect(pendiente?.scheduledAt.toISOString()).toBe(new Date(NEW_START.getTime() - 24 * 60 * 60_000).toISOString());
  });
});
