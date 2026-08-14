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

import { rescheduleCourseAutomations, scheduleEnrollmentAutomations } from "./engine";
import { DEFAULT_AUTOMATION_PLAN } from "./default-automations";

const NOW = new Date("2026-08-06T15:00:00.000Z");
const REGISTERED_AT = new Date("2026-08-06T14:30:00.000Z");
/** 7 de agosto 19:30 en Guayaquil. */
const SESSION_START = new Date("2026-08-08T00:30:00.000Z");
const SESSION_END = new Date("2026-08-08T01:30:00.000Z");

/**
 * Se usa el mismo formateador que el motor. Escribir "7:30 p. m." a mano falla:
 * es-EC separa "p." y "m." con un espacio duro (U+00A0), no con uno normal.
 */
const esDate = new Intl.DateTimeFormat("es-EC", { dateStyle: "long", timeZone: "America/Guayaquil" });
const esTime = new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" });

type StoredMessage = Record<string, any>;
let messages: StoredMessage[];

function identityOf(message: StoredMessage) {
  return `${message.leadId}|${message.enrollmentId}|${message.sequenceKey}|${message.stepKey}`;
}

function planRule(planKey: string) {
  const entry = DEFAULT_AUTOMATION_PLAN.find((item) => item.planKey === planKey);
  if (!entry) throw new Error(`Regla inexistente: ${planKey}`);
  return {
    id: `rule-${entry.planKey}`,
    planKey: entry.planKey,
    courseId: "course-1",
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

function enrollment(overrides: { sessions?: any[]; startsAt?: Date | null; streamUrl?: string | null; rules?: any[] } = {}) {
  return {
    id: "enrollment-1",
    leadId: "lead-1",
    courseId: "course-1",
    campaignId: null,
    status: "INSCRITO",
    createdAt: REGISTERED_AT,
    lead: {
      id: "lead-1", firstName: "QA", lastName: "Preview", fullName: "QA PREVIEW FINAL",
      email: "qa@example.test", phone: "+593987654321",
      classification: "REAL", consent: true, assignedToId: null,
    },
    course: {
      id: "course-1",
      title: "Desarrollo Profesional en Marketing",
      officialCourseUrl: "https://ra-training.com/courses-1/",
      courseCompleteUrl: "https://ra-training.com/curso-completo",
      whatsappGroupUrl: "https://chat.whatsapp.com/qa",
      surveyUrl: "https://forms.example.com/encuesta",
      moodleCourseUrl: null,
      modality: "Virtual",
      isPublished: true,
      acceptsRegistrations: false,
      startsAt: overrides.startsAt === undefined ? null : overrides.startsAt,
      endsAt: null,
      streamUrl: overrides.streamUrl === undefined ? "https://meet.example.com/marketing" : overrides.streamUrl,
      sessions: overrides.sessions ?? [{ id: "s1", title: null, startAt: SESSION_START, endAt: SESSION_END, streamUrl: null }],
      automationRules: overrides.rules ?? [planRule("welcome")],
    },
  };
}

const welcome = () => messages.find((message) => message.sequenceKey === "automation:EMAIL:welcome");

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
  mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1" }]);
});

describe("contenido de la bienvenida", () => {
  it("usa la sesión futura cuando el curso no tiene startsAt", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    const body = welcome()?.body ?? "";
    expect(body).not.toContain("por confirmar");
    // es-EC formatea la hora como "7:30 p. m.", no en formato 24 h.
    expect(body).toContain(`Fecha: ${esDate.format(SESSION_START)}`);
    expect(body).toContain(`Hora: ${esTime.format(SESSION_START)}`);
    // El enlace de la reunión no viaja en la bienvenida: llega 2 horas antes.
    expect(body).not.toContain("https://meet.example.com/marketing");
  });

  it("elige la primera sesión futura cuando hay varias", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [
        { id: "s2", title: null, startAt: new Date("2026-08-15T00:30:00.000Z"), endAt: null, streamUrl: "https://meet.example.com/segunda" },
        { id: "s1", title: null, startAt: SESSION_START, endAt: SESSION_END, streamUrl: "https://meet.example.com/primera" },
      ],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    const body = welcome()?.body ?? "";
    expect(body).toContain(esDate.format(SESSION_START));
    expect(body).not.toContain("https://meet.example.com/primera");
    expect(body).not.toContain(esDate.format(new Date("2026-08-15T00:30:00.000Z")));
  });

  it("ignora las sesiones ya pasadas al elegir la que describe", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [
        { id: "s0", title: null, startAt: new Date("2026-07-01T00:30:00.000Z"), endAt: null, streamUrl: null },
        { id: "s1", title: null, startAt: SESSION_START, endAt: SESSION_END, streamUrl: null },
      ],
    }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(welcome()?.body).toContain(esDate.format(SESSION_START));
    expect(welcome()?.body).not.toContain(esDate.format(new Date("2026-07-01T00:30:00.000Z")));
  });

  it("conserva el comportamiento heredado sin sesiones pero con startsAt", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ sessions: [], startsAt: SESSION_START }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    const body = welcome()?.body ?? "";
    expect(body).toContain(`Fecha: ${esDate.format(SESSION_START)}`);
    expect(body).toContain(`Hora: ${esTime.format(SESSION_START)}`);
  });

  it("omite el bloque de fecha cuando el curso no tiene ninguna", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ sessions: [], startsAt: null }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    const body = welcome()?.body ?? "";
    // Repetir «por confirmar» dos veces seguidas es ruido: mejor no decir nada.
    expect(body).not.toContain("por confirmar");
    expect(body).not.toContain("Fecha:");
    expect(body).not.toContain("Hora:");
    // El resto del correo sigue en pie y no queda un hueco donde iba el bloque.
    expect(body).toContain("Tu inscripción a Desarrollo Profesional en Marketing");
    expect(body).not.toMatch(/\n{3,}/);
  });

  it("la bienvenida nunca lleva el enlace de la reunión, haya o no", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ streamUrl: null }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    const body = welcome()?.body ?? "";
    expect(body).not.toContain("Enlace de acceso");
    expect(body).toContain(`Fecha: ${esDate.format(SESSION_START)}`);
  });
});

describe("la bienvenida sigue programada al inscribirse", () => {
  it("no se mueve a la fecha de la sesión", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(welcome()?.scheduledAt.toISOString()).toBe(REGISTERED_AT.toISOString());
  });

  it("no queda ligada a ninguna sesión ni cambia su clave idempotente", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    // Ligarla a la sesión haría que borrar esa sesión cancelara la bienvenida.
    expect(welcome()?.courseSessionId).toBeNull();
    expect(welcome()?.stepKey).toBe("enrollment:enrollment-1");
  });

  it("no genera mensajes adicionales", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(1);
  });
});

describe("recordatorio de 24 horas ya vencido", () => {
  it("no se crea ni se envía tarde, y se contabiliza sin error", async () => {
    // Inscripción a las 14:30Z del 6 de agosto; la sesión empieza a las 00:30Z
    // del 8. El recordatorio de 24 h correspondía a las 00:30Z del 7… que aún
    // no pasó. Se adelanta la sesión para que sí haya vencido.
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [{ id: "s1", title: null, startAt: new Date("2026-08-07T00:30:00.000Z"), endAt: null, streamUrl: null }],
      rules: [planRule("reminder_24h")],
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.enqueued).toBe(0);
    // Es una condición normal del calendario, no un fallo técnico.
    expect(result.reason).toBe("NO_APPLICABLE_RULES");
  });

  it("el recordatorio de 2 horas de la misma sesión sí se programa", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({
      sessions: [{ id: "s1", title: null, startAt: new Date("2026-08-07T00:30:00.000Z"), endAt: null, streamUrl: null }],
      rules: [planRule("reminder_24h"), planRule("reminder_2h")],
    }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(1);
    expect(messages[0].sequenceKey).toBe("automation:EMAIL:reminder_2h");
  });
});

/**
 * El enlace de la reunión solo viaja en los dos correos que preceden a la
 * sesión. Es una decisión del negocio, no un detalle de redacción: un enlace
 * repartido en cinco correos obliga a buscar cuál era el bueno.
 */
describe("dónde viaja el enlace de la reunión", () => {
  const CON_ENLACE = new Set(["reminder_2h", "reminder_15m", "session_live", "late_access"]);

  for (const entrada of DEFAULT_AUTOMATION_PLAN) {
    const deberia = CON_ENLACE.has(entrada.planKey);
    it(`${entrada.planKey} ${deberia ? "lleva" : "no lleva"} el enlace`, () => {
      const lleva = entrada.body.includes("{{bloqueEnlace}}") || entrada.body.includes("{{streamUrl}}") || entrada.body.includes("{{link_reunion}}");
      expect(lleva).toBe(deberia);
    });
  }

  it("solo el de 15 minutos se omite cuando falta el enlace", () => {
    const exigen = DEFAULT_AUTOMATION_PLAN.filter((entrada) => entrada.requiresStreamUrl).map((entrada) => entrada.planKey);
    // El de 2 horas sigue siendo un recordatorio útil sin enlace (por ejemplo
    // en un curso presencial); el de 15 minutos sin enlace no dice nada.
    expect(exigen).toEqual(["reminder_2h", "reminder_15m", "session_live", "late_access"]);
  });
});

describe("idempotencia tras el arreglo", () => {
  it("reprogramar no duplica ni reescribe lo ya enviado", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ sessions: [], startsAt: null }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(welcome()?.body).not.toContain("Fecha:");

    // La bienvenida ya salió: su texto es historial y no debe reescribirse.
    const sent = welcome();
    if (sent) sent.status = "SIMULADO";
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    const second = await scheduleEnrollmentAutomations("enrollment-1", NOW);

    expect(messages).toHaveLength(1);
    expect(second.enqueued).toBe(0);
    expect(welcome()?.body).not.toContain("Fecha:");
  });

  it("una bienvenida todavía pendiente sí se corrige al reprogramar", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ sessions: [], startsAt: null }));
    await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(welcome()?.body).not.toContain("Fecha:");

    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    const second = await scheduleEnrollmentAutomations("enrollment-1", NOW);

    expect(messages).toHaveLength(1);
    expect(second.updated).toBe(1);
    expect(welcome()?.body).toContain(esDate.format(SESSION_START));
  });

  it("una regla de bienvenida creada después de la inscripción no saluda hacia atrás", async () => {
    // Es el escenario de aplicar el plan estándar a un curso que ya tiene
    // inscritos: sin este freno todos recibirían de nuevo "tu inscripción fue
    // registrada", porque la bienvenida está exenta del filtro de fechas pasadas.
    const reciente = { ...planRule("welcome"), createdAt: new Date(REGISTERED_AT.getTime() + 86_400_000) };
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules: [reciente] }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(messages).toHaveLength(0);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("una regla anterior a la inscripción sí envía la bienvenida", async () => {
    const previa = { ...planRule("welcome"), createdAt: new Date(REGISTERED_AT.getTime() - 86_400_000) };
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment({ rules: [previa] }));
    const result = await scheduleEnrollmentAutomations("enrollment-1", NOW);
    expect(result.enqueued).toBe(1);
  });

  it("aplicar el plan repetidamente no duplica mensajes", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue(enrollment());
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-1" }]).mockResolvedValue([]);
    await rescheduleCourseAutomations("course-1", NOW);
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([{ id: "enrollment-1" }]).mockResolvedValue([]);
    const second = await rescheduleCourseAutomations("course-1", NOW);
    expect(messages).toHaveLength(1);
    expect(second.enqueued).toBe(0);
  });
});
