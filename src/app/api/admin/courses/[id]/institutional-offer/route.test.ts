// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: { course: { findUnique: vi.fn(), update: vi.fn() } },
  writeAudit: vi.fn(async () => undefined),
  reprogramarOfertaAutomatica: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/commerce/offer-campaign", () => ({ reprogramarOfertaAutomatica: mocks.reprogramarOfertaAutomatica }));

import { PATCH } from "./route";

function peticion(courseId: string, body: unknown) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/institutional-offer`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
  mocks.prisma.course.update.mockResolvedValue({});
});

describe("PATCH courses/[id]/institutional-offer", () => {
  it("guarda url, precio y horas, y recalcula la oferta automática", async () => {
    const res = await peticion("course-1", {
      institutionalOfferUrl: "https://ra-training.com/oferta-institucional/",
      institutionalOfferPrice: 45,
      institutionalOfferDelayHours: 48,
      confirm: true,
    });
    expect(res.status).toBe(200);
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { institutionalOfferUrl: "https://ra-training.com/oferta-institucional/", institutionalOfferPrice: 45, institutionalOfferDelayHours: 48 },
    });
    expect(mocks.reprogramarOfertaAutomatica).toHaveBeenCalledWith("course-1", expect.anything());
  });

  it("rechaza una URL fuera del dominio oficial", async () => {
    const res = await peticion("course-1", { institutionalOfferUrl: "https://evil.example/oferta", confirm: true });
    expect(res.status).toBe(422);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("cadena vacía borra la URL (null, no '')", async () => {
    await peticion("course-1", { institutionalOfferUrl: "", confirm: true });
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({ where: { id: "course-1" }, data: { institutionalOfferUrl: null } });
  });

  it("solo actualiza los campos enviados", async () => {
    await peticion("course-1", { institutionalOfferDelayHours: 12, confirm: true });
    const data = mocks.prisma.course.update.mock.calls[0][0].data;
    expect(data).toEqual({ institutionalOfferDelayHours: 12 });
  });

  it("sin confirm explícito se rechaza sin tocar la base", async () => {
    const res = await peticion("course-1", { institutionalOfferDelayHours: 12 });
    expect(res.status).toBe(422);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("un curso inexistente responde 404", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const res = await peticion("curso-fantasma", { institutionalOfferDelayHours: 12, confirm: true });
    expect(res.status).toBe(404);
  });

  it("si el recálculo de la oferta falla, la respuesta igual confirma que se guardó", async () => {
    mocks.reprogramarOfertaAutomatica.mockRejectedValue(new Error("token=secreto"));
    const res = await peticion("course-1", { institutionalOfferDelayHours: 12, confirm: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, changed: true });
  });
});
