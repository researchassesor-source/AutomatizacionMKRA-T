// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  wordpressCatalogConfigured: vi.fn(() => true),
  analyzeWordPressSync: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/wordpress-catalog", () => ({ wordpressCatalogConfigured: mocks.wordpressCatalogConfigured }));
vi.mock("@/lib/wordpress-sync-orchestrator", () => ({ analyzeWordPressSync: mocks.analyzeWordPressSync }));

import { POST } from "./route";

function peticion(body: unknown = { confirm: "SYNC_WORDPRESS_READ_ONLY" }) {
  return POST(new Request("https://crm.example.test/api/admin/courses/catalog/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.wordpressCatalogConfigured.mockReturnValue(true);
  mocks.analyzeWordPressSync.mockResolvedValue({ ok: true, totals: { unchanged: 0, newCourse: 0, scheduleChanged: 0, noScheduleSource: 0, error: 0 }, items: [] });
});

describe("POST catalog/analyze", () => {
  it("sin confirm explícito, se rechaza sin llamar al orquestador", async () => {
    const res = await peticion({});
    expect(res.status).toBe(422);
    expect(mocks.analyzeWordPressSync).not.toHaveBeenCalled();
  });

  it("catálogo no configurado responde 409 sin llamar al orquestador", async () => {
    mocks.wordpressCatalogConfigured.mockReturnValue(false);
    const res = await peticion();
    expect(res.status).toBe(409);
    expect(mocks.analyzeWordPressSync).not.toHaveBeenCalled();
  });

  it("con confirm, delega en analyzeWordPressSync y devuelve su resultado", async () => {
    mocks.analyzeWordPressSync.mockResolvedValue({
      ok: true,
      totals: { unchanged: 3, newCourse: 1, scheduleChanged: 2, noScheduleSource: 0, error: 0 },
      items: [{ courseId: "c1", courseTitle: "Curso", status: "NEW_COURSE", existingSessions: [], calendarRevision: "abc" }],
    });
    const res = await peticion();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals).toMatchObject({ unchanged: 3, newCourse: 1, scheduleChanged: 2 });
    expect(body.items).toHaveLength(1);
  });

  it("si el catálogo falla, responde 502 con un mensaje seguro (sin detalle interno)", async () => {
    mocks.analyzeWordPressSync.mockResolvedValue({ ok: false, catalogError: "La sincronización se detuvo de forma segura (WORDPRESS_API_EMPTY_CATALOG).", totals: { unchanged: 0, newCourse: 0, scheduleChanged: 0, noScheduleSource: 0, error: 0 }, items: [] });
    const res = await peticion();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("WORDPRESS_API_EMPTY_CATALOG");
  });

  it("sin sesión válida no llega a analizar nada", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion();
    expect(res.status).toBe(401);
    expect(mocks.analyzeWordPressSync).not.toHaveBeenCalled();
  });
});
