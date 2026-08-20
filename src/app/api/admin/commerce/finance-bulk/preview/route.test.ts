// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  previewBulkFinanceHandoff: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/finance/bulk-handoff", () => ({ previewBulkFinanceHandoff: mocks.previewBulkFinanceHandoff }));

import { POST } from "./route";

function peticion(body: unknown) {
  return POST(new Request("https://crm.example.test/api/admin/commerce/finance-bulk/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.previewBulkFinanceHandoff.mockResolvedValue({ courseId: "course-1", courseTitle: "Curso", total: 5, porEnviar: 3, yaVinculados: 1, cancelados: 1, requierenConfiguracion: 0, items: [] });
});

describe("POST finance-bulk/preview", () => {
  it("devuelve el resumen de la vista previa", async () => {
    const res = await peticion({ courseId: "course-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, porEnviar: 3, yaVinculados: 1, cancelados: 1 });
  });

  it("sin courseId se rechaza sin consultar nada", async () => {
    const res = await peticion({});
    expect(res.status).toBe(422);
    expect(mocks.previewBulkFinanceHandoff).not.toHaveBeenCalled();
  });

  it("curso inexistente responde 404", async () => {
    mocks.previewBulkFinanceHandoff.mockRejectedValue(new Error("COURSE_NOT_FOUND"));
    const res = await peticion({ courseId: "curso-fantasma" });
    expect(res.status).toBe(404);
  });

  it("sin sesión válida no consulta nada", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion({ courseId: "course-1" });
    expect(res.status).toBe(401);
    expect(mocks.previewBulkFinanceHandoff).not.toHaveBeenCalled();
  });
});
