// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTOMATION_PLAN } from "@/lib/nurture/default-automations";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    automationRule: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
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

function peticion(body: unknown) {
  return POST(new Request("https://crm.example.test/api/admin/automations/defaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const RESCHEDULE_VACIO = { enrollments: 3, enqueued: 2, updated: 0, omitted: 1, cancelled: 0, batches: 1, truncated: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", startsAt: null, endsAt: null, streamUrl: null, sessions: [] });
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.create.mockImplementation(async ({ data }: any) => ({ id: `rule-${data.planKey}`, ...data }));
  mocks.prisma.automationRule.update.mockImplementation(async ({ data }: any) => ({ ...data }));
  mocks.rescheduleCourseAutomations.mockResolvedValue(RESCHEDULE_VACIO);
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
});

/**
 * Continuación arquitectónica: "aplicar defaults ACTIVE" tenía el mismo bug
 * de fondo que el resto de la reconciliación puntual -- si el reschedule
 * fallaba, un reintento encontraba las reglas YA creadas/activadas
 * (created=0, activated=0) y por eso NUNCA volvía a intentar el recálculo:
 * el curso se quedaba con reglas activas pero sin cola, y ni una segunda
 * llamada lo arreglaba.
 */
describe("POST /api/admin/automations/defaults", () => {
  it("con activate:false crea el plan en DRAFT y no reprograma nada", async () => {
    const res = await peticion({ courseId: "course-1", activate: false, channel: "EMAIL" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.created).toBe(DEFAULT_AUTOMATION_PLAN.length);
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("con activate:true crea, activa y reconcilia el curso", async () => {
    const res = await peticion({ courseId: "course-1", activate: true, channel: "EMAIL" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.created).toBe(DEFAULT_AUTOMATION_PLAN.length);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
    expect(body.enrollments).toMatchObject({ processed: 3, enqueued: 2 });
  });

  it("marca el curso pendiente de reconciliación antes de reconciliar", async () => {
    await peticion({ courseId: "course-1", activate: true, channel: "EMAIL" });
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "DEFAULTS_ACTIVATED" },
    });
  });

  it("reaplicar sobre un curso que YA tiene el plan activo (created=0, activated=0) IGUAL reconcilia -- corrige el bug del reintento ciego", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue(
      DEFAULT_AUTOMATION_PLAN.map((entry) => ({ id: `rule-${entry.planKey}`, planKey: entry.planKey, status: "ACTIVE" })),
    );
    const res = await peticion({ courseId: "course-1", activate: true, channel: "EMAIL" });
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(body.activated).toBe(0);
    // Antes del arreglo, created=0/activated=0 significaba "no reprogramar
    // nada" -- exactamente el escenario de un reintento tras un fallo previo.
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });

  it("si el recálculo falla dos veces, la respuesta sigue en 200 pero marcada pending, sin filtrar el error crudo", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto conexión perdida"));
    const res = await peticion({ courseId: "course-1", activate: true, channel: "EMAIL" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pending).toBe(true);
    expect(body.created).toBe(DEFAULT_AUTOMATION_PLAN.length);
    expect(JSON.stringify(body)).not.toMatch(/secreto/);
  });

  it("reaplicar el plan no duplica reglas existentes ni pisa contenido ya editado", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue(
      DEFAULT_AUTOMATION_PLAN.map((entry) => ({ id: `rule-${entry.planKey}`, planKey: entry.planKey, status: "DRAFT" })),
    );
    const res = await peticion({ courseId: "course-1", activate: true, channel: "EMAIL" });
    const body = await res.json();
    expect(mocks.prisma.automationRule.create).not.toHaveBeenCalled();
    expect(body.activated).toBe(DEFAULT_AUTOMATION_PLAN.length);
  });

  it("un curso inexistente responde 422 sin crear nada", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const res = await peticion({ courseId: "curso-fantasma", activate: true, channel: "EMAIL" });
    expect(res.status).toBe(422);
    expect(mocks.prisma.automationRule.create).not.toHaveBeenCalled();
  });
});
