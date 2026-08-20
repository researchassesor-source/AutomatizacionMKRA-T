import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  confirmEnrollmentWithFinance: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/finance/handoff", () => ({ confirmEnrollmentWithFinance: mocks.confirmEnrollmentWithFinance }));

import { FINANCE_HANDOFF_ROLES } from "@/lib/finance/authorization";
import { POST } from "./route";

function request(body: unknown = { confirm: true }) {
  return new Request("https://crm.example.test/api/admin/enrollments/enrollment-1/finance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({
    session: { userId: "user-1", email: "direccion@example.test", role: "DIRECCION" },
    error: null,
  });
  mocks.confirmEnrollmentWithFinance.mockResolvedValue({ ok: true, financeInscripcionId: "finance-1" });
});

describe("POST /api/admin/enrollments/[id]/finance", () => {
  it("aplica server-side exactamente el permiso Técnico/Dirección", async () => {
    const req = request();
    const response = await POST(req, { params: Promise.resolve({ id: "enrollment-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith(req, FINANCE_HANDOFF_ROLES);
    expect(FINANCE_HANDOFF_ROLES).toEqual(["ADMIN", "DIRECCION"]);
  });

  it("no ejecuta el handoff si la autorización rechaza la petición", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response(null, { status: 403 }) });
    const response = await POST(request(), { params: Promise.resolve({ id: "enrollment-1" }) });
    expect(response.status).toBe(403);
    expect(mocks.confirmEnrollmentWithFinance).not.toHaveBeenCalled();
  });

  it("exige confirmación explícita y sanitiza el error de Finance", async () => {
    const invalid = await POST(request({ confirm: false }), { params: Promise.resolve({ id: "enrollment-1" }) });
    expect(invalid.status).toBe(422);
    mocks.confirmEnrollmentWithFinance.mockRejectedValue(new Error("token=secreto timeout interno"));
    const failed = await POST(request(), { params: Promise.resolve({ id: "enrollment-1" }) });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "No se pudo enviar la inscripción a Finance." });
  });

  it("FINANCE_SERVICE_NOT_CONFIGURED responde 422 con el motivo exacto, no un genérico", async () => {
    mocks.confirmEnrollmentWithFinance.mockRejectedValue(new Error("FINANCE_SERVICE_NOT_CONFIGURED"));
    const response = await POST(request(), { params: Promise.resolve({ id: "enrollment-1" }) });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Este curso no está configurado como un servicio activo en Finance." });
  });

  it("FINANCE_AUTH_FAILED responde 503, no 502 genérico", async () => {
    mocks.confirmEnrollmentWithFinance.mockRejectedValue(new Error("FINANCE_AUTH_FAILED"));
    const response = await POST(request(), { params: Promise.resolve({ id: "enrollment-1" }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Finance no está disponible en este momento." });
  });
});
