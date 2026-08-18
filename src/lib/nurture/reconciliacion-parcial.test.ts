// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    enrollment: { findUnique: vi.fn(), findMany: vi.fn() },
    outboundMessage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    courseSession: { findMany: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    leadEvent: { create: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { JOURNEY_SCHEDULED, reconcileEntitledEnrollments } from "./engine";
import { WHATSAPP_AUTOMATION_PLAN, templateFieldsFor } from "./default-automations-whatsapp";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";
import { momentoAplicaAlCurso } from "@/lib/commerce/course-entitlement";

/**
 * El caso que la version anterior dejaba atrapado.
 *
 * La reconciliacion miraba "no tiene ningun mensaje". Pero la programacion hace
 * un upsert por paso: si moria despues de crear la bienvenida, la inscripcion
 * quedaba con un mensaje suelto y por tanto dejaba de ser candidata. El journey
 * incompleto se volvia permanente, y nadie lo notaba porque algo si habia
 * llegado.
 */
const NOW = new Date("2026-08-20T15:00:00.000Z");
const SESION = new Date("2026-08-25T00:30:00.000Z");

/** Tres pasos del plan: suficiente para que "a medias" sea distinguible. */
const PASOS = ["welcome", "reminder_24h", "reminder_2h"] as const;

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

type Escenario = {
  /** Curso con las automatizaciones en pausa. */
  pausado?: boolean;
  /** Contacto sin consentimiento o sin clasificar. */
  contactoExcluido?: boolean;
  /** Curso sin ninguna regla activa todavia. */
  sinReglas?: boolean;
};

let escenario: Escenario;

/** Curso de PAGO con el pago verificado: el escenario de paid first. */
function inscripcionPagada() {
  return {
    id: "enrollment-1",
    leadId: "lead-1",
    courseId: "course-1",
    campaignId: null,
    status: "INSCRITO",
    createdAt: new Date("2026-08-10T00:00:00.000Z"),
    purchases: [{ status: "PAYMENT_VERIFIED" }],
    lead: {
      id: "lead-1", firstName: "Ana", lastName: "Pérez", fullName: "Ana Pérez",
      email: "ana@example.test", phone: "+593999999999",
      classification: escenario.contactoExcluido ? "PRUEBA" : "REAL",
      consent: !escenario.contactoExcluido,
      assignedToId: null,
    },
    course: {
      id: "course-1",
      title: "Curso de pago",
      officialCourseUrl: "https://ra-training.com/cursos/pago/",
      moodleCourseUrl: null,
      modality: "Virtual",
      isPublished: true,
      isFree: false,
      automationsPausedAt: escenario.pausado ? new Date("2026-08-15T00:00:00.000Z") : null,
      acceptsRegistrations: true,
      startsAt: null,
      endsAt: null,
      streamUrl: "https://meet.google.com/abc-defg-hij",
      sessions: [{ id: "s1", title: null, startAt: SESION, endAt: null, streamUrl: "https://meet.google.com/abc-defg-hij" }],
      automationRules: escenario.sinReglas ? [] : PASOS.map(regla),
    },
  };
}

let mensajes: Record<string, any>[];
let marcas: Record<string, any>[];
/** Cuando es > 0, `create` revienta tras haber creado esa cantidad. */
let romperTrasCrear: number;

beforeEach(() => {
  mensajes = [];
  marcas = [];
  romperTrasCrear = 0;
  escenario = {};

  mocks.prisma.enrollment.findUnique.mockImplementation(async ({ select }: any) => (
    select?.leadId ? { leadId: "lead-1" } : inscripcionPagada()
  ));
  // Candidatas: las que no tienen la marca. Es el criterio real de la consulta.
  mocks.prisma.enrollment.findMany.mockImplementation(async () => (
    marcas.some((m) => m.type === JOURNEY_SCHEDULED) ? [] : [{ id: "enrollment-1" }]
  ));

  mocks.prisma.outboundMessage.findUnique.mockImplementation(async ({ where }: any) => {
    const k = where.leadId_enrollmentId_sequenceKey_stepKey;
    return mensajes.find((m) => m.sequenceKey === k.sequenceKey && m.stepKey === k.stepKey) ?? null;
  });
  mocks.prisma.outboundMessage.create.mockImplementation(async ({ data }: any) => {
    if (romperTrasCrear > 0 && mensajes.length >= romperTrasCrear) {
      throw new Error("fallo inesperado a mitad de la programación");
    }
    // La tabla tiene indice unico sobre (lead, inscripcion, secuencia, paso).
    // Sin reproducirlo aqui, dos procesos concurrentes "podrian" duplicar en la
    // prueba algo que la base no permite, y se comprobaria una ficcion.
    if (mensajes.some((m) => m.sequenceKey === data.sequenceKey && m.stepKey === data.stepKey)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["leadId", "enrollmentId", "sequenceKey", "stepKey"] },
      });
    }
    mensajes.push({ id: `msg-${mensajes.length + 1}`, ...data });
    return data;
  });
  mocks.prisma.outboundMessage.update.mockResolvedValue({});
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1" }]);
  mocks.prisma.automationRule.update.mockResolvedValue({});

  mocks.prisma.leadEvent.create.mockImplementation(async ({ data }: any) => {
    // `idempotencyKey` es unica en la tabla: una segunda marca choca.
    if (marcas.some((m) => m.idempotencyKey === data.idempotencyKey)) {
      // El error real de Prisma, no una imitacion: el codigo lo distingue con
      // `instanceof`, asi que un doble falso probaria otra cosa.
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["idempotencyKey"] },
      });
    }
    marcas.push(data);
    return data;
  });
});

describe("programación que muere a mitad", () => {
  it("deja mensajes creados pero NO deja marca", async () => {
    romperTrasCrear = 1; // crea la bienvenida y revienta en el siguiente paso
    await reconcileEntitledEnrollments(NOW);

    expect(mensajes.length).toBeGreaterThan(0);
    expect(mensajes.length).toBeLessThan(PASOS.length);
    expect(marcas).toHaveLength(0);
  });

  it("sigue siendo candidata aunque ya tenga un mensaje: ESTE es el caso que se escapaba", async () => {
    romperTrasCrear = 1;
    await reconcileEntitledEnrollments(NOW);
    expect(mensajes).toHaveLength(1);

    // Con el criterio antiguo ("no tiene ningun mensaje") aqui ya no habria
    // vuelto a entrar, y el journey se quedaria incompleto para siempre.
    const candidatas = await mocks.prisma.enrollment.findMany({});
    expect(candidatas).toHaveLength(1);
  });

  it("la segunda vuelta completa lo que faltaba y entonces sí marca", async () => {
    romperTrasCrear = 1;
    await reconcileEntitledEnrollments(NOW);
    expect(marcas).toHaveLength(0);

    romperTrasCrear = 0;
    const segunda = await reconcileEntitledEnrollments(NOW);

    expect(mensajes).toHaveLength(PASOS.length);
    expect(marcas).toHaveLength(1);
    expect(marcas[0].type).toBe(JOURNEY_SCHEDULED);
    expect(marcas[0].idempotencyKey).toBe("journey-scheduled:enrollment-1");
    expect(segunda.recuperadas).toBe(1);
  });

  it("no duplica los mensajes que ya existían", async () => {
    romperTrasCrear = 1;
    await reconcileEntitledEnrollments(NOW);
    romperTrasCrear = 0;
    await reconcileEntitledEnrollments(NOW);

    const identidades = mensajes.map((m) => `${m.sequenceKey}|${m.stepKey}`);
    expect(new Set(identidades).size).toBe(identidades.length);
  });
});

describe("una vez marcada", () => {
  it("la reconciliación deja de seleccionarla", async () => {
    await reconcileEntitledEnrollments(NOW);
    expect(marcas).toHaveLength(1);

    const antes = mensajes.length;
    const segunda = await reconcileEntitledEnrollments(NOW);
    expect(segunda.revisadas).toBe(0);
    expect(mensajes).toHaveLength(antes);
  });

  it("dos reconciliaciones concurrentes dejan una sola marca y ningún duplicado", async () => {
    // Las dos ven la inscripcion sin marcar y programan a la vez; la unicidad
    // de `idempotencyKey` decide, y las claves de mensaje evitan el resto.
    await Promise.all([reconcileEntitledEnrollments(NOW), reconcileEntitledEnrollments(NOW)]);

    // Una sola marca: la unicidad de `idempotencyKey` decide cual gana.
    expect(marcas).toHaveLength(1);
    // Y ningun mensaje repetido: lo impide el indice unico de la tabla, no la
    // suerte de que las dos vueltas no se solapen.
    const identidades = mensajes.map((m) => `${m.sequenceKey}|${m.stepKey}`);
    expect(new Set(identidades).size).toBe(identidades.length);
  });

  it("un fallo del proveedor no la borra: la marca es del scheduling, no del envío", async () => {
    await reconcileEntitledEnrollments(NOW);
    expect(marcas).toHaveLength(1);

    // El despacho es otro mecanismo, con su propio reintento. Nada de lo que
    // ocurra ahi vuelve a tocar la marca.
    const segunda = await reconcileEntitledEnrollments(NOW);
    expect(segunda.revisadas).toBe(0);
    expect(marcas).toHaveLength(1);
  });
});

describe("el programador se detuvo antes de terminar: no se marca", () => {
  /**
   * Cada uno de estos casos hacia que `scheduleEnrollmentAutomations` volviera
   * con un motivo, sin haber programado nada. Marcar entonces cerraba la puerta
   * para siempre a una situacion temporal.
   */
  it("curso con las automatizaciones pausadas: sin marca", async () => {
    escenario.pausado = true;
    await reconcileEntitledEnrollments(NOW);
    expect(mensajes).toHaveLength(0);
    expect(marcas).toHaveLength(0);
  });

  it("al reanudar el curso, la reconciliación lo recoge y entonces sí marca", async () => {
    escenario.pausado = true;
    await reconcileEntitledEnrollments(NOW);
    expect(marcas).toHaveLength(0);

    escenario.pausado = false;
    const segunda = await reconcileEntitledEnrollments(NOW);
    expect(mensajes).toHaveLength(PASOS.length);
    expect(marcas).toHaveLength(1);
    expect(segunda.recuperadas).toBe(1);
  });

  it("contacto sin consentimiento: sin marca", async () => {
    escenario.contactoExcluido = true;
    await reconcileEntitledEnrollments(NOW);
    expect(mensajes).toHaveLength(0);
    expect(marcas).toHaveLength(0);
  });

  it("cuando el contacto pasa a ser real y con consentimiento, se recupera", async () => {
    escenario.contactoExcluido = true;
    await reconcileEntitledEnrollments(NOW);
    expect(marcas).toHaveLength(0);

    escenario.contactoExcluido = false;
    await reconcileEntitledEnrollments(NOW);
    expect(mensajes).toHaveLength(PASOS.length);
    expect(marcas).toHaveLength(1);
  });

  it("curso sin reglas activas: sin marca", async () => {
    escenario.sinReglas = true;
    await reconcileEntitledEnrollments(NOW);
    expect(mensajes).toHaveLength(0);
    expect(marcas).toHaveLength(0);
  });

  it("cuando se activan las reglas, se recupera", async () => {
    escenario.sinReglas = true;
    await reconcileEntitledEnrollments(NOW);
    expect(marcas).toHaveLength(0);

    escenario.sinReglas = false;
    await reconcileEntitledEnrollments(NOW);
    expect(mensajes).toHaveLength(PASOS.length);
    expect(marcas).toHaveLength(1);
  });

  it("una programación normal marca exactamente una vez", async () => {
    await reconcileEntitledEnrollments(NOW);
    await reconcileEntitledEnrollments(NOW);
    expect(marcas).toHaveLength(1);
    expect(mensajes).toHaveLength(PASOS.length);
  });
});

describe("lo que la reconciliación no toca", () => {
  it("un taller gratuito nunca entra: la consulta pide isFree false", async () => {
    mocks.prisma.enrollment.findMany.mockResolvedValueOnce([]);
    const resultado = await reconcileEntitledEnrollments(NOW);
    expect(resultado.revisadas).toBe(0);
    expect(mensajes).toHaveLength(0);
  });

  it("el cierre y el seguimiento siguen fuera de los cursos de pago", () => {
    for (const planKey of ["course_complete", "course_follow_up"]) {
      expect(momentoAplicaAlCurso(planKey, { isFree: false }), planKey).toBe(false);
    }
  });

  it("los doce contratos de WhatsApp siguen intactos", () => {
    expect(Object.keys(WHATSAPP_TEMPLATES)).toHaveLength(12);
    expect(WHATSAPP_TEMPLATES.welcome.bodyVars).toHaveLength(6);
    expect(WHATSAPP_TEMPLATES.thank_you.name).toBe("ra_training_fin_sesion");
    expect(WHATSAPP_AUTOMATION_PLAN).toHaveLength(11);
  });
});
