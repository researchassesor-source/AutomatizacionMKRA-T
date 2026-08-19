// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    inboundMessage: { updateMany: vi.fn() },
    lead: { findUnique: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
  requireRole: vi.fn(async () => ({
    session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" },
    error: null,
  })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0, distributed: false })),
  recuperarAutomatizacionesDelContacto: vi.fn(async () => 0),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit, requestKey: () => "whatsapp-conversation-patch:test" }));
vi.mock("@/lib/whatsapp/handoff-expiry", () => ({ recuperarAutomatizacionesDelContacto: mocks.recuperarAutomatizacionesDelContacto }));

import { PATCH } from "./route";

function patch(id: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/whatsapp/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function conversacion(overrides: Partial<{ leadId: string | null; state: string }> = {}) {
  return {
    id: "conv-1",
    phone: "+593999999999",
    leadId: overrides.leadId === undefined ? "lead-1" : overrides.leadId,
    assignedToId: null,
    state: overrides.state ?? "HUMAN_HANDOFF",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, distributed: false });
  mocks.prisma.conversation.findUnique.mockResolvedValue(conversacion());
  mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.recuperarAutomatizacionesDelContacto.mockResolvedValue(0);
});

/**
 * Sección 38: cerrar la atención a mano no reactivaba lo comercial que se
 * había callado durante el handoff. Quedaba OMITIDO/HUMAN_HANDOFF_ACTIVE
 * hasta que algo más tocara ese curso por otro motivo, sin relación alguna
 * con este cierre.
 */
describe("PATCH conversación: cerrar atención recupera lo comercial del contacto", () => {
  it("RESOLVED sobre una conversación vinculada reprograma los cursos del contacto vinculado", async () => {
    const res = await patch("conv-1", { state: "RESOLVED" });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).toHaveBeenCalledWith("lead-1");
  });

  it("HUMAN_HANDOFF (abrir, no cerrar) no dispara la recuperación", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacion({ state: "AUTOMATION" }));
    const res = await patch("conv-1", { state: "HUMAN_HANDOFF" });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });

  it("conversación sin contacto vinculado: resuelve sin reventar y sin intentar recuperar nada", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacion({ leadId: null }));
    const res = await patch("conv-1", { state: "RESOLVED" });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });

  it("vincular un contacto nuevo en la misma petición que resuelve usa el leadId final, no el previo", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacion({ leadId: null }));
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-nuevo", phone: "+593999999999" });
    const res = await patch("conv-1", { state: "RESOLVED", leadId: "lead-nuevo" });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).toHaveBeenCalledWith("lead-nuevo");
  });

  it("una petición sin cambios de estado (solo reasignar) no toca la recuperación", async () => {
    const res = await patch("conv-1", { assignedToId: null });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });
});
