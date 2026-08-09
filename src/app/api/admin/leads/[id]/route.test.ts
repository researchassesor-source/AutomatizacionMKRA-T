// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    lead: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    leadEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  writeAudit: vi.fn(async () => undefined),
  requireRole: vi.fn(async () => ({ session: { userId: "technical-qa", email: "technical@local.test", role: "ADMIN" }, error: null })),
  cancelPendingMessages: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/nurture/engine", () => ({ cancelPendingMessages: mocks.cancelPendingMessages }));

import { DELETE } from "./route";

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
