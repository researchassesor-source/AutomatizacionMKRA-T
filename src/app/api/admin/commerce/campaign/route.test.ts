// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: { certificationOfferCampaign: { findUnique: vi.fn() } },
  activarOfertaAutomatica: vi.fn(),
  detenerOfertaAutomatica: vi.fn(),
  asegurarCampana: vi.fn(),
  sincronizarDestinatarios: vi.fn(),
  encolarOferta: vi.fn(),
  seleccionar: vi.fn(),
  excluir: vi.fn(),
  restaurar: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/commerce/offer-eligibility", () => ({ advertenciaComercial: () => null }));
vi.mock("@/lib/commerce/offer-campaign", () => ({
  activarOfertaAutomatica: mocks.activarOfertaAutomatica,
  detenerOfertaAutomatica: mocks.detenerOfertaAutomatica,
  asegurarCampana: mocks.asegurarCampana,
  sincronizarDestinatarios: mocks.sincronizarDestinatarios,
  encolarOferta: mocks.encolarOferta,
  seleccionar: mocks.seleccionar,
  excluir: mocks.excluir,
  restaurar: mocks.restaurar,
}));

import { POST } from "./route";

function peticion(body: unknown) {
  return POST(new Request("https://crm.example.test/api/admin/commerce/campaign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.activarOfertaAutomatica.mockResolvedValue({ id: "campaign-1", status: "SCHEDULED" });
  mocks.detenerOfertaAutomatica.mockResolvedValue({ id: "campaign-1", status: "CANCELLED" });
  mocks.sincronizarDestinatarios.mockResolvedValue({ agregados: 0, total: 0 });
});

/**
 * Sección Q: la tarjeta #12 se selecciona/deselecciona con las mismas
 * acciones que el resto de la UI unificada de comunicaciones.
 */
describe("POST commerce/campaign: activar (seleccionar la tarjeta #12)", () => {
  it("activa la campaña automática y sincroniza destinatarios", async () => {
    const res = await peticion({ accion: "activar", courseId: "course-1" });
    expect(res.status).toBe(200);
    expect(mocks.activarOfertaAutomatica).toHaveBeenCalledWith("course-1", { email: "tecnico@example.test" });
    expect(mocks.sincronizarDestinatarios).toHaveBeenCalledWith("campaign-1");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "SCHEDULED" });
  });

  it("curso inexistente responde 404", async () => {
    mocks.activarOfertaAutomatica.mockResolvedValue(null);
    const res = await peticion({ accion: "activar", courseId: "curso-fantasma" });
    expect(res.status).toBe(404);
    expect(mocks.sincronizarDestinatarios).not.toHaveBeenCalled();
  });

  it("sin courseId se rechaza sin llamar nada", async () => {
    const res = await peticion({ accion: "activar" });
    expect(res.status).toBe(422);
    expect(mocks.activarOfertaAutomatica).not.toHaveBeenCalled();
  });
});

describe("POST commerce/campaign: detener (deseleccionar la tarjeta #12)", () => {
  it("detiene la campaña sin borrar nada", async () => {
    const res = await peticion({ accion: "detener", courseId: "course-1" });
    expect(res.status).toBe(200);
    expect(mocks.detenerOfertaAutomatica).toHaveBeenCalledWith("course-1", { email: "tecnico@example.test" });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "CANCELLED" });
  });

  it("sin campaña previa, responde ok con status null (nada que detener)", async () => {
    mocks.detenerOfertaAutomatica.mockResolvedValue(null);
    const res = await peticion({ accion: "detener", courseId: "course-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBeNull();
  });
});

describe("seguridad", () => {
  it("sin sesión válida no ejecuta ninguna acción", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion({ accion: "activar", courseId: "course-1" });
    expect(res.status).toBe(401);
    expect(mocks.activarOfertaAutomatica).not.toHaveBeenCalled();
  });

  it("una acción desconocida se rechaza", async () => {
    const res = await peticion({ accion: "inventada", courseId: "course-1" });
    expect(res.status).toBe(422);
  });
});
