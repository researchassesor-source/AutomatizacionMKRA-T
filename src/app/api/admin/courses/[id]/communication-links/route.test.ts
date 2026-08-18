// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn() },
  },
  writeAudit: vi.fn(async (_input: any) => undefined),
  requireRole: vi.fn(async (): Promise<{ session: { userId: string; email: string; role: string } | null; error: Response | null }> => ({
    session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" },
    error: null,
  })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));

import { PATCH } from "./route";

/**
 * Endpoint propio para los tres enlaces del recorrido.
 *
 * El riesgo que se prueba es que un PATCH de un enlace nunca toque nada mas
 * del curso: precio, publicacion, fechas. `course.update` solo debe recibir
 * los campos que vinieron en el cuerpo.
 */
function peticion(courseId: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/communication-links`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
  mocks.prisma.course.update.mockResolvedValue({ id: "course-1" });
});

describe("guardar un enlace", () => {
  it("actualiza solo el campo enviado, nada más del curso", async () => {
    const res = await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/abc", confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { whatsappGroupUrl: "https://chat.whatsapp.com/abc" },
    });
  });

  it("los tres campos se pueden guardar juntos", async () => {
    await peticion("course-1", {
      whatsappGroupUrl: "https://chat.whatsapp.com/abc",
      courseCompleteUrl: "https://ra-training.com/gracias",
      surveyUrl: "https://forms.example.com/encuesta",
      confirm: true,
    });
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: {
        whatsappGroupUrl: "https://chat.whatsapp.com/abc",
        courseCompleteUrl: "https://ra-training.com/gracias",
        surveyUrl: "https://forms.example.com/encuesta",
      },
    });
  });

  it("una cadena vacía borra el enlace (se guarda null, no '')", async () => {
    await peticion("course-1", { surveyUrl: "", confirm: true });
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { surveyUrl: null },
    });
  });

  it("null también borra el enlace", async () => {
    await peticion("course-1", { courseCompleteUrl: null, confirm: true });
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { courseCompleteUrl: null },
    });
  });

  it("un campo no incluido en el cuerpo no se toca", async () => {
    await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/abc", confirm: true });
    const data = mocks.prisma.course.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("courseCompleteUrl");
    expect(data).not.toHaveProperty("surveyUrl");
    // Tampoco campos ajenos a los enlaces, ni el propio flag de confirmación.
    expect(data).not.toHaveProperty("price");
    expect(data).not.toHaveProperty("isPublished");
    expect(data).not.toHaveProperty("isFree");
    expect(data).not.toHaveProperty("confirm");
  });

  it("registra la auditoría con los campos tocados, no con las URLs", async () => {
    await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/abc", confirm: true });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "COURSE_COMMUNICATION_LINKS_UPDATED",
      entityType: "Course",
      entityId: "course-1",
      metadata: { campos: ["whatsappGroupUrl"], configurados: 1 },
    }));
  });
});

describe("validación", () => {
  it("una URL mal formada se rechaza y no toca la base", async () => {
    const res = await peticion("course-1", { whatsappGroupUrl: "no-es-una-url", confirm: true });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.errorCode).toBe("LINK_INVALID");
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("un cuerpo vacío se rechaza", async () => {
    const res = await peticion("course-1", { confirm: true });
    expect(res.status).toBe(422);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("un curso inexistente responde 404", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const res = await peticion("curso-fantasma", { surveyUrl: "https://forms.example.com/x", confirm: true });
    expect(res.status).toBe(404);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });
});

describe("confirm obligatorio", () => {
  it("sin confirm se rechaza y no toca la base", async () => {
    const res = await peticion("course-1", { surveyUrl: "https://forms.example.com/x" });
    expect(res.status).toBe(422);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("confirm:false se rechaza igual que si faltara", async () => {
    const res = await peticion("course-1", { surveyUrl: "https://forms.example.com/x", confirm: false });
    expect(res.status).toBe(422);
    expect(mocks.prisma.course.update).not.toHaveBeenCalled();
  });

  it("confirm:true con al menos un enlace funciona", async () => {
    const res = await peticion("course-1", { surveyUrl: "https://forms.example.com/x", confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.course.update).toHaveBeenCalledTimes(1);
  });
});

describe("seguridad", () => {
  it("sin sesión válida no llega a tocar la base", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion("course-1", { surveyUrl: "https://forms.example.com/x", confirm: true });
    expect(res.status).toBe(401);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
  });
});
