// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    campaign: { findUnique: vi.fn() },
    automationRule: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((callback: any) => callback(mocks.tx)),
  },
  tx: {
    automationRule: { create: vi.fn() },
    course: { update: vi.fn() },
  },
  rescheduleCourseAutomations: vi.fn(),
  reprogramarOfertaAutomatica: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));
vi.mock("@/lib/commerce/offer-campaign", () => ({ reprogramarOfertaAutomatica: mocks.reprogramarOfertaAutomatica }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { POST } from "./route";

const CUERPO_VALIDO = {
  courseId: "course-1",
  name: "Recordatorio nuevo",
  trigger: "ON_REGISTRATION" as const,
  offsetMinutes: 0,
  channel: "EMAIL" as const,
  subject: "Hola",
  body: "Hola {{nombre}}",
  status: "ACTIVE" as const,
  requiresStreamUrl: false,
  enrollmentStatuses: ["INTERESADO"] as const,
};

function peticion(body: unknown) {
  return POST(new Request("https://crm.example.test/api/admin/automations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", sessions: [] });
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.tx.automationRule.create.mockImplementation(async ({ data }: any) => ({ id: "rule-nueva", ...data }));
  mocks.tx.course.update.mockResolvedValue({});
  mocks.rescheduleCourseAutomations.mockResolvedValue({ enrollments: 0, enqueued: 0, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false });
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
});

/**
 * Sección 3 de la continuación arquitectónica: crear una regla ACTIVE debe
 * reflejarse de inmediato en las inscripciones ya existentes. Antes, este
 * endpoint no llamaba a nada que las recalculara: una regla creada ya activa
 * quedaba invisible para quien ya estaba inscrito hasta que otra mutación
 * tocara ese curso por un motivo ajeno.
 */
describe("POST /api/admin/automations: crear una regla", () => {
  it("crea la regla con el curso y los campos enviados", async () => {
    const res = await peticion(CUERPO_VALIDO);
    expect(res.status).toBe(201);
    expect(mocks.tx.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ courseId: "course-1", name: "Recordatorio nuevo", status: "ACTIVE" }),
    }));
  });

  it("crear DIRECTAMENTE en ACTIVE fija activatedAt, igual que una activación real", async () => {
    await peticion(CUERPO_VALIDO);
    const { data } = mocks.tx.automationRule.create.mock.calls[0][0];
    expect(data.activatedAt).toBeInstanceOf(Date);
  });

  it("crear en DRAFT no fija activatedAt: todavía no envía a nadie", async () => {
    await peticion({ ...CUERPO_VALIDO, status: "DRAFT" });
    const { data } = mocks.tx.automationRule.create.mock.calls[0][0];
    expect(data.activatedAt).toBeNull();
  });

  it("crear ACTIVE recalcula la cola de las inscripciones existentes del curso", async () => {
    await peticion(CUERPO_VALIDO);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });

  it("crear en DRAFT NO recalcula nada: una regla sin activar no puede enviar", async () => {
    await peticion({ ...CUERPO_VALIDO, status: "DRAFT" });
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("crear ACTIVE marca el curso pendiente de reconciliación dentro de la MISMA transacción que crea la regla", async () => {
    await peticion(CUERPO_VALIDO);
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "RULE_CREATED_ACTIVE" },
    });
  });

  it("si el recálculo falla dos veces, la regla igual queda creada, marcada pendiente (el cron la recupera)", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto conexión perdida"));
    const res = await peticion(CUERPO_VALIDO);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.rule).toBeDefined();
    expect(body.pending).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secreto/);
  });

  it("un curso inexistente responde 422 sin crear nada", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const res = await peticion(CUERPO_VALIDO);
    expect(res.status).toBe(422);
    expect(mocks.tx.automationRule.create).not.toHaveBeenCalled();
  });

  it("una campaña que no corresponde al curso responde 422", async () => {
    mocks.prisma.campaign.findUnique.mockResolvedValue({ id: "camp-1", courseId: "otro-curso" });
    const res = await peticion({ ...CUERPO_VALIDO, campaignId: "camp-1" });
    expect(res.status).toBe(422);
    expect(mocks.tx.automationRule.create).not.toHaveBeenCalled();
  });

  it("sin sesión válida no crea nada", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response(null, { status: 401 }) });
    const res = await peticion(CUERPO_VALIDO);
    expect(res.status).toBe(401);
    expect(mocks.tx.automationRule.create).not.toHaveBeenCalled();
  });
});
