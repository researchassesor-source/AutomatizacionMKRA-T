// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  executeBulkFinanceHandoff: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/finance/bulk-handoff", () => ({ executeBulkFinanceHandoff: mocks.executeBulkFinanceHandoff }));

import { POST } from "./route";

function peticion(body: unknown) {
  return POST(new Request("https://crm.example.test/api/admin/commerce/finance-bulk/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.executeBulkFinanceHandoff.mockResolvedValue({ courseId: "course-1", total: 3, enviados: 3, fallidos: 0, fallaGlobal: null, detalle: [] });
});

describe("POST finance-bulk/execute", () => {
  it("sin el literal de confirmación, se rechaza sin ejecutar nada", async () => {
    const res = await peticion({ courseId: "course-1" });
    expect(res.status).toBe(422);
    expect(mocks.executeBulkFinanceHandoff).not.toHaveBeenCalled();
  });

  it("con confirmación, ejecuta y devuelve el resultado", async () => {
    const res = await peticion({ courseId: "course-1", confirm: "SEND_COURSE_TO_FINANCE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, enviados: 3, fallidos: 0 });
  });

  it("audita el resultado, incluida una falla global", async () => {
    mocks.executeBulkFinanceHandoff.mockResolvedValue({ courseId: "course-1", total: 3, enviados: 1, fallidos: 0, fallaGlobal: "FINANCE_NOT_AVAILABLE", detalle: [] });
    await peticion({ courseId: "course-1", confirm: "SEND_COURSE_TO_FINANCE" });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "FINANCE_BULK_HANDOFF",
      result: "FAILURE",
      metadata: expect.objectContaining({ fallaGlobal: "FINANCE_NOT_AVAILABLE" }),
    }));
  });

  it("curso inexistente responde 404", async () => {
    mocks.executeBulkFinanceHandoff.mockRejectedValue(new Error("COURSE_NOT_FOUND"));
    const res = await peticion({ courseId: "curso-fantasma", confirm: "SEND_COURSE_TO_FINANCE" });
    expect(res.status).toBe(404);
  });

  it("sin sesión válida no ejecuta nada", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion({ courseId: "course-1", confirm: "SEND_COURSE_TO_FINANCE" });
    expect(res.status).toBe(401);
    expect(mocks.executeBulkFinanceHandoff).not.toHaveBeenCalled();
  });
});
