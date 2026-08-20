// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  applyCourseSchedule: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/wordpress-sync-orchestrator", () => ({ applyCourseSchedule: mocks.applyCourseSchedule }));

import { POST } from "./route";

function item(courseId: string) {
  return { courseId, calendarRevision: `rev-${courseId}`, sessions: [{ startAt: "2026-09-01T00:30:00.000Z", endAt: null }] };
}

function peticion(body: unknown) {
  return POST(new Request("https://crm.example.test/api/admin/courses/catalog/apply-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.applyCourseSchedule.mockResolvedValue({ ok: true, updated: 1, removed: 0, created: 0, cancelledMessages: 0, quarantinedMessages: 1, rescheduled: {} });
});

/**
 * Sección L: una sola confirmación global, pero cada curso se aplica de
 * forma independiente. Un curso desactualizado (409 individual) no debe
 * bloquear a los demás.
 */
describe("POST catalog/apply-all", () => {
  it("sin el literal de confirmación, se rechaza sin aplicar nada", async () => {
    const res = await peticion({ items: [item("c1")] });
    expect(res.status).toBe(422);
    expect(mocks.applyCourseSchedule).not.toHaveBeenCalled();
  });

  it("lista vacía se rechaza", async () => {
    const res = await peticion({ confirm: "APPLY_ALL_SAFE_CHANGES", items: [] });
    expect(res.status).toBe(422);
  });

  it("aplica cada curso de la lista, reutilizando applyCourseSchedule por curso", async () => {
    const res = await peticion({ confirm: "APPLY_ALL_SAFE_CHANGES", items: [item("c1"), item("c2")] });
    expect(res.status).toBe(200);
    expect(mocks.applyCourseSchedule).toHaveBeenCalledTimes(2);
    expect(mocks.applyCourseSchedule).toHaveBeenCalledWith("c1", { calendarRevision: "rev-c1", sessions: expect.any(Array) }, expect.anything());
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, total: 2, aplicados: 2, desactualizados: 0, fallidos: 0 });
  });

  it("un curso desactualizado (REVISION_MISMATCH) NO bloquea a los demás: resultado por curso", async () => {
    mocks.applyCourseSchedule
      .mockResolvedValueOnce({ ok: false, code: "REVISION_MISMATCH" })
      .mockResolvedValueOnce({ ok: true, updated: 1, removed: 0, created: 0, cancelledMessages: 0, quarantinedMessages: 0, rescheduled: {} });

    const res = await peticion({ confirm: "APPLY_ALL_SAFE_CHANGES", items: [item("c1"), item("c2")] });
    const body = await res.json();

    expect(mocks.applyCourseSchedule).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ total: 2, aplicados: 1, desactualizados: 1, fallidos: 0 });
    expect(body.resultados[0]).toMatchObject({ courseId: "c1", ok: false, error: expect.stringContaining("cambió mientras lo revisabas") });
    expect(body.resultados[1]).toMatchObject({ courseId: "c2", ok: true });
  });

  it("un fallo de transacción en un curso se reporta como fallido, sin detener a los demás", async () => {
    mocks.applyCourseSchedule
      .mockResolvedValueOnce({ ok: false, code: "TRANSACTION_FAILED" })
      .mockResolvedValueOnce({ ok: true, updated: 0, removed: 0, created: 1, cancelledMessages: 0, quarantinedMessages: 0, rescheduled: {} });
    const res = await peticion({ confirm: "APPLY_ALL_SAFE_CHANGES", items: [item("c1"), item("c2")] });
    const body = await res.json();
    expect(body).toMatchObject({ aplicados: 1, desactualizados: 0, fallidos: 1 });
  });

  it("registra una auditoría con el resumen, no con las fechas ni sesiones", async () => {
    await peticion({ confirm: "APPLY_ALL_SAFE_CHANGES", items: [item("c1")] });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "WORDPRESS_CATALOG_SCHEDULE_APPLY_ALL",
      metadata: expect.objectContaining({ total: 1, aplicados: 1 }),
    }));
  });

  it("sin sesión válida no aplica nada", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion({ confirm: "APPLY_ALL_SAFE_CHANGES", items: [item("c1")] });
    expect(res.status).toBe(401);
    expect(mocks.applyCourseSchedule).not.toHaveBeenCalled();
  });
});
