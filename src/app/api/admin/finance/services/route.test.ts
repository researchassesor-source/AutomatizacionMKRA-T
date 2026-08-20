// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  isFinanceConfigured: vi.fn(() => true),
  isFinanceSimulation: vi.fn(() => false),
  listActiveFinanceServices: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/finance/client", () => ({
  isFinanceConfigured: mocks.isFinanceConfigured,
  isFinanceSimulation: mocks.isFinanceSimulation,
  listActiveFinanceServices: mocks.listActiveFinanceServices,
}));

import { GET } from "./route";

function peticion() {
  return GET(new Request("https://crm.example.test/api/admin/finance/services"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.isFinanceConfigured.mockReturnValue(true);
  mocks.isFinanceSimulation.mockReturnValue(false);
  mocks.listActiveFinanceServices.mockResolvedValue([{ id: "SRV-1", nombre: "Curso", modalidad: "Virtual", activo: true }]);
});

describe("GET finance/services", () => {
  it("devuelve la lista de servicios activos", async () => {
    const res = await peticion();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.services).toEqual([{ id: "SRV-1", nombre: "Curso", modalidad: "Virtual", activo: true }]);
  });

  it("Finance no configurado responde 503 sin llamar al cliente", async () => {
    mocks.isFinanceConfigured.mockReturnValue(false);
    const res = await peticion();
    expect(res.status).toBe(503);
    expect(mocks.listActiveFinanceServices).not.toHaveBeenCalled();
  });

  it("Finance en simulación responde 503 (nunca lista servicios reales)", async () => {
    mocks.isFinanceSimulation.mockReturnValue(true);
    const res = await peticion();
    expect(res.status).toBe(503);
    expect(mocks.listActiveFinanceServices).not.toHaveBeenCalled();
  });

  it("un fallo de autenticación de Finance responde 503, no 500 ni 200 vacío", async () => {
    mocks.listActiveFinanceServices.mockRejectedValue(new Error("FINANCE_AUTH_FAILED"));
    const res = await peticion();
    expect(res.status).toBe(503);
  });

  it("un fallo genérico de Finance responde 502 sin filtrar detalle interno", async () => {
    mocks.listActiveFinanceServices.mockRejectedValue(new Error("token=secreto https://interno"));
    const res = await peticion();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/secreto|https:\/\/interno/);
  });

  it("sin sesión válida no llega a consultar Finance", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion();
    expect(res.status).toBe(401);
    expect(mocks.listActiveFinanceServices).not.toHaveBeenCalled();
  });
});
