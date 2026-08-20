// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles de Prisma usan objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: {
    automationRule: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    campaign: { findUnique: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async (_args: any) => ({ count: 0 })) },
    $transaction: vi.fn((callback: any) => callback(mocks.prisma)),
  },
  rescheduleCourseAutomations: vi.fn(async () => ({ enrollments: 0, enqueued: 0, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false })),
  reprogramarOfertaAutomatica: vi.fn(async () => null),
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));
vi.mock("@/lib/commerce/offer-campaign", () => ({ reprogramarOfertaAutomatica: mocks.reprogramarOfertaAutomatica }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { PATCH } from "./route";

const RULE_BASE = {
  id: "rule-1",
  courseId: "course-1",
  campaignId: null,
  name: "Bienvenida",
  trigger: "ON_REGISTRATION" as const,
  offsetMinutes: 0,
  channel: "EMAIL" as const,
  subject: "Hola",
  body: "Hola {{nombre}}",
  status: "ACTIVE" as const,
  requiresStreamUrl: false,
  enrollmentStatuses: ["INTERESADO", "INSCRITO"] as const,
};

function request(body: unknown) {
  return new Request("https://crm.example.test/api/admin/automations/rule-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ id: "rule-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", startsAt: null, endsAt: null, streamUrl: null, sessions: [] });
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.update.mockImplementation(async ({ data }: any) => ({ ...RULE_BASE, ...data }));
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
});

/**
 * Requisito 33/40-E del release de estabilización: editar una regla que YA
 * está ACTIVE (texto, horario) nunca debe mover `activatedAt`. Es justo lo
 * que rompía comparar contra `updatedAt`: cualquier edición reenamoraba la
 * fecha y podía silenciar la bienvenida de inscripciones anteriores.
 */
describe("PATCH automations/[id]: activatedAt solo se mueve en una activación real", () => {
  it("editar el asunto de una regla ya ACTIVE no toca activatedAt", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    const res = await PATCH(request({ ...RULE_BASE, subject: "Asunto corregido", confirm: true }), params());
    expect(res.status).toBe(200);
    const data = mocks.prisma.automationRule.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("activatedAt");
  });

  it("PAUSED -> ACTIVE (reactivación real) sí fija activatedAt", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "PAUSED" });
    await PATCH(request({ ...RULE_BASE, status: "ACTIVE", confirm: true }), params());
    const data = mocks.prisma.automationRule.update.mock.calls[0][0].data;
    expect(data.activatedAt).toBeInstanceOf(Date);
  });

  it("ACTIVE -> PAUSED no fija activatedAt (no es una activación)", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "PAUSED", confirm: true }), params());
    const data = mocks.prisma.automationRule.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("activatedAt");
  });

  it("reenviar status:ACTIVE sobre una regla que ya estaba ACTIVE no lo cuenta como activación", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "ACTIVE", confirm: true }), params());
    const data = mocks.prisma.automationRule.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("activatedAt");
  });
});

describe("PATCH automations/[id]: pausa reversible vs archivado definitivo", () => {
  it("pasar a PAUSED pone los mensajes PROGRAMADO/FALLIDO en OMITIDO/RULE_PAUSED, no CANCELADO, ANTES de guardar", async () => {
    const orden: string[] = [];
    mocks.prisma.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cuarentena"); return { count: 0 }; });
    mocks.prisma.automationRule.update.mockImplementation(async ({ data }: any) => { orden.push("guardar"); return { ...RULE_BASE, ...data }; });
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });

    await PATCH(request({ ...RULE_BASE, status: "PAUSED", confirm: true }), params());

    expect(orden).toEqual(["cuarentena", "guardar"]);
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { automationRuleId: "rule-1", status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "RULE_PAUSED", nextAttemptAt: null }),
    });
  });

  it("pasar a ARCHIVED sí cancela PROGRAMADO/OMITIDO/FALLIDO (cierre, no pausa)", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "ARCHIVED", confirm: true }), params());
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { automationRuleId: "rule-1", status: { in: ["PROGRAMADO", "OMITIDO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "CANCELADO", errorCode: "AUTOMATION_DISABLED" }),
    });
  });

  it("reprograma el curso cuando el resultado queda ACTIVE, nunca si queda PAUSED", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "PAUSED" });
    await PATCH(request({ ...RULE_BASE, status: "ACTIVE", confirm: true }), params());
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));

    mocks.rescheduleCourseAutomations.mockClear();
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, status: "PAUSED", confirm: true }), params());
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("una edición que deja la regla ACTIVE marca el curso pendiente de reconciliación en la misma transacción", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, body: "Cuerpo editado {{nombre}}", confirm: true }), params());
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "RULE_CONTENT_CHANGED" },
    });
  });

  it("si el recálculo falla dos veces, la edición igual queda guardada, marcada pendiente (el cron la recupera)", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto conexión perdida"));
    const res = await PATCH(request({ ...RULE_BASE, subject: "Asunto editado", confirm: true }), params());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pending).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secreto/);
  });
});

/**
 * Sección I del release de estabilización: editar el cuerpo, horario, canal
 * o gate de enlace de una regla que sigue ACTIVE no tenía ninguna protección.
 * A diferencia de course/link/session, sendMessage no vuelve a comprobar el
 * contenido de la regla al enviar: la cuarentena aquí es la única defensa.
 */
describe("PATCH automations/[id]: editar contenido de una regla ACTIVE pone en cuarentena antes de guardar", () => {
  it("cambiar el body pone en cuarentena (SCHEDULE_RECONCILING), ANTES de guardar", async () => {
    const orden: string[] = [];
    mocks.prisma.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cuarentena"); return { count: 5 }; });
    mocks.prisma.automationRule.update.mockImplementation(async ({ data }: any) => { orden.push("guardar"); return { ...RULE_BASE, ...data }; });
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });

    await PATCH(request({ ...RULE_BASE, body: "Hola {{nombre}}, texto corregido", confirm: true }), params());

    expect(orden).toEqual(["cuarentena", "guardar"]);
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { automationRuleId: "rule-1", status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "SCHEDULE_RECONCILING" }),
    });
  });

  it("cambiar el offsetMinutes también dispara la cuarentena", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, offsetMinutes: 120, confirm: true }), params());
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalled();
  });

  it("solo el asunto sin cambio real (mismo texto) NO dispara cuarentena", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "ACTIVE" });
    await PATCH(request({ ...RULE_BASE, confirm: true }), params());
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  it("una regla que NO está (ni queda) ACTIVE no dispara la cuarentena por SCHEDULE_RECONCILING", async () => {
    mocks.prisma.automationRule.findUnique.mockResolvedValue({ ...RULE_BASE, status: "DRAFT" });
    await PATCH(request({ ...RULE_BASE, status: "DRAFT", body: "Texto nuevo, distinto del original", confirm: true }), params());
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });
});
