// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    lead: { findUnique: vi.fn(), findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    leadEvent: { create: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async (_args: any) => ({ count: 0 })) },
    $transaction: vi.fn(),
  },
  writeAudit: vi.fn(async () => undefined),
  requireRole: vi.fn(async () => ({ session: { userId: "technical-qa", email: "technical@local.test", role: "ADMIN" }, error: null })),
  recuperarAutomatizacionesDelContacto: vi.fn(async () => 0),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/whatsapp/handoff-expiry", () => ({ recuperarAutomatizacionesDelContacto: mocks.recuperarAutomatizacionesDelContacto }));

import { DELETE, PATCH } from "./route";

const contacts = new Map<string, { id: string; fullName: string; email: string; classification: string }>();

function deletionRequest(id: string, name: string, acknowledgeRealDeletion = true) {
  return new Request(`https://crm.example.test/api/admin/leads/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "delete-test", confirmName: name, acknowledgeRealDeletion }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  contacts.clear();
  contacts.set("selected", { id: "selected", fullName: "Contacto QA", email: "selected@local.test", classification: "TEST" });
  contacts.set("other", { id: "other", fullName: "Otro Contacto QA", email: "other@local.test", classification: "TEST" });
  mocks.prisma.lead.findUnique.mockImplementation(async ({ where }: any) => contacts.get(where.id) ?? null);
  mocks.prisma.lead.delete.mockImplementation(async ({ where }: any) => {
    const current = contacts.get(where.id);
    contacts.delete(where.id);
    return current;
  });
  mocks.prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
  mocks.prisma.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
  mocks.prisma.lead.findFirst.mockResolvedValue(null);
  mocks.prisma.leadEvent.create.mockResolvedValue({});
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
});

function contacto(overrides: Partial<{ id: string; classification: string; consent: boolean; isArchived: boolean; stage: string }> = {}) {
  return {
    id: "lead-1",
    firstName: "Ana",
    lastName: "Pérez",
    fullName: "Ana Pérez",
    email: "ana@example.test",
    phone: "+593999999999",
    stage: "NUEVO",
    classification: "REAL",
    consent: true,
    isArchived: false,
    ...overrides,
  };
}

function patch(id: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/**
 * Sección H del release de estabilización: archivar un contacto usaba
 * `cancelPendingMessages` (CANCELADO, irreversible). Restaurarlo después no
 * traía de vuelta nada, porque CANCELADO no es reprogramable. Ahora archivar
 * usa OMITIDO (recuperable) y restaurar/reclasificar como REAL dispara la
 * recuperación.
 */
describe("PATCH /api/admin/leads/[id]: archivar, restaurar y reclasificar", () => {
  it("archivar pone en cuarentena (OMITIDO), no cancela (CANCELADO)", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(contacto({ isArchived: false }));
    mocks.prisma.lead.update.mockResolvedValue(contacto({ isArchived: true }));
    await patch("lead-1", { isArchived: true, confirm: true });
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { leadId: "lead-1", status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "CONTACT_ARCHIVED" }),
    });
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });

  it("restaurar (isArchived: false) recupera las automatizaciones del contacto", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(contacto({ isArchived: true }));
    mocks.prisma.lead.update.mockResolvedValue(contacto({ isArchived: false }));
    await patch("lead-1", { isArchived: false, confirm: true });
    expect(mocks.recuperarAutomatizacionesDelContacto).toHaveBeenCalledWith("lead-1");
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  it("reclasificar de REAL a TEST pone en cuarentena con CONTACT_EXCLUDED", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(contacto({ classification: "REAL" }));
    mocks.prisma.lead.update.mockResolvedValue(contacto({ classification: "TEST" }));
    await patch("lead-1", { classification: "TEST", confirm: true });
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { leadId: "lead-1", status: { in: ["PROGRAMADO", "FALLIDO"] } },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "CONTACT_EXCLUDED" }),
    });
  });

  it("reclasificar de TEST a REAL recupera las automatizaciones", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(contacto({ classification: "TEST" }));
    mocks.prisma.lead.update.mockResolvedValue(contacto({ classification: "REAL" }));
    await patch("lead-1", { classification: "REAL", confirm: true });
    expect(mocks.recuperarAutomatizacionesDelContacto).toHaveBeenCalledWith("lead-1");
  });

  it("cambiar de REAL a REAL (sin cambio real) no dispara ni cuarentena ni recuperación", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(contacto({ classification: "REAL" }));
    mocks.prisma.lead.update.mockResolvedValue(contacto({ classification: "REAL" }));
    // classification no cambia de valor: no exige confirm ni dispara nada de esto.
    await patch("lead-1", { firstName: "Ana", classification: "REAL" });
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });

  it("un cambio no relacionado (solo el nombre) no toca la cola ni la recuperación", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(contacto());
    mocks.prisma.lead.update.mockResolvedValue(contacto({ id: "lead-1" }));
    await patch("lead-1", { firstName: "Ana María" });
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/leads/[id]", () => {
  it("elimina únicamente el contacto seleccionado y conserva cualquier otro", async () => {
    const response = await DELETE(deletionRequest("selected", "Contacto QA"), { params: Promise.resolve({ id: "selected" }) });

    expect(response.status).toBe(200);
    expect(contacts.has("selected")).toBe(false);
    expect(contacts.get("other")?.fullName).toBe("Otro Contacto QA");
    expect(mocks.prisma.lead.delete).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.lead.delete).toHaveBeenCalledWith({ where: { id: "selected" } });
  });

  it("no elimina nada cuando la confirmación no coincide", async () => {
    const response = await DELETE(deletionRequest("selected", "Nombre incorrecto"), { params: Promise.resolve({ id: "selected" }) });

    expect(response.status).toBe(422);
    expect(contacts.has("selected")).toBe(true);
    expect(contacts.has("other")).toBe(true);
    expect(mocks.prisma.lead.delete).not.toHaveBeenCalled();
  });
});
