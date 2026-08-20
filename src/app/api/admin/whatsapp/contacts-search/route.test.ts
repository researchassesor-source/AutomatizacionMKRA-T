// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: { lead: { findMany: vi.fn() } },
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { GET } from "./route";

function peticion(q: string) {
  return GET(new Request(`https://crm.example.test/api/admin/whatsapp/contacts-search?q=${encodeURIComponent(q)}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.prisma.lead.findMany.mockResolvedValue([{ id: "lead-1", fullName: "Ana Pérez", email: "ana@example.test", phone: "+593999999999" }]);
});

/**
 * Sección V del release de estabilización: el modal de vinculación llamaba a
 * un GET inexistente (/api/admin/leads solo tiene POST) -- la búsqueda
 * nunca funcionaba, fallaba en silencio con una lista vacía.
 */
describe("GET whatsapp/contacts-search", () => {
  it("busca por nombre, correo y teléfono a la vez", async () => {
    await peticion("Ana");
    expect(mocks.prisma.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { fullName: { contains: "Ana", mode: "insensitive" } },
          { email: { contains: "Ana", mode: "insensitive" } },
          { phone: { contains: "Ana" } },
        ],
      }),
    }));
  });

  it("nunca devuelve el teléfono completo, solo los últimos 4 dígitos", async () => {
    const res = await peticion("Ana");
    const body = await res.json();
    expect(body.contacts[0].phonePartial).toBe("…9999");
    expect(JSON.stringify(body)).not.toContain("+593999999999");
  });

  it("excluye contactos archivados", async () => {
    await peticion("Ana");
    const { where } = mocks.prisma.lead.findMany.mock.calls[0][0];
    expect(where.isArchived).toBe(false);
  });

  it("una búsqueda demasiado corta no toca la base", async () => {
    const res = await peticion("a");
    const body = await res.json();
    expect(body.contacts).toEqual([]);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it("sin sesión válida no busca nada", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion("Ana");
    expect(res.status).toBe(401);
    expect(mocks.prisma.lead.findMany).not.toHaveBeenCalled();
  });
});
