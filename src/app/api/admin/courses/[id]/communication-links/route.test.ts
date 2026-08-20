// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    course: { update: vi.fn() },
    outboundMessage: { updateMany: vi.fn(async (_args: any) => ({ count: 0 })) },
  },
  writeAudit: vi.fn(async (_input: any) => undefined),
  requireRole: vi.fn(async (): Promise<{ session: { userId: string; email: string; role: string } | null; error: Response | null }> => ({
    session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" },
    error: null,
  })),
  rescheduleCourseAutomations: vi.fn(async () => ({})),
  reprogramarOfertaAutomatica: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));
vi.mock("@/lib/commerce/offer-campaign", () => ({ reprogramarOfertaAutomatica: mocks.reprogramarOfertaAutomatica }));

import { PATCH } from "./route";

/**
 * Endpoint propio para los tres enlaces del recorrido.
 *
 * El riesgo que se prueba es que un PATCH de un enlace nunca toque nada mas
 * del curso: precio, publicacion, fechas. `course.update` solo debe recibir
 * los campos que vinieron en el cuerpo. Y desde la sección D del release de
 * estabilización: cambiar un enlace pone en cuarentena (ANTES de guardar, en
 * la misma transacción) los mensajes pendientes del momento correspondiente,
 * para que nunca salgan con el enlace viejo ya congelado en el cuerpo.
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
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.tx.course.update.mockResolvedValue({ id: "course-1" });
  mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.rescheduleCourseAutomations.mockResolvedValue({});
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
});

describe("guardar un enlace", () => {
  it("actualiza solo el campo enviado, nada más del curso", async () => {
    const res = await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/abc", confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
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
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
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
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { surveyUrl: null },
    });
  });

  it("null también borra el enlace", async () => {
    await peticion("course-1", { courseCompleteUrl: null, confirm: true });
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { courseCompleteUrl: null },
    });
  });

  it("un campo no incluido en el cuerpo no se toca", async () => {
    await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/abc", confirm: true });
    const data = mocks.tx.course.update.mock.calls[0][0].data;
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
      metadata: expect.objectContaining({ campos: ["whatsappGroupUrl"], configurados: 1 }),
    }));
  });
});

describe("cuarentena antes de guardar y reprogramación después", () => {
  it("cambiar whatsappGroupUrl pone en cuarentena los pendientes de whatsapp_group, ANTES de guardar", async () => {
    const orden: string[] = [];
    mocks.tx.outboundMessage.updateMany.mockImplementation(async () => { orden.push("cuarentena"); return { count: 2 }; });
    mocks.tx.course.update.mockImplementation(async () => { orden.push("guardar"); return { id: "course-1" }; });

    const res = await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/nuevo", confirm: true });
    const body = await res.json();

    // "guardar" aparece dos veces: la escritura de los enlaces y, en la misma
    // transacción, la marca de reconciliación pendiente.
    expect(orden).toEqual(["cuarentena", "guardar", "guardar"]);
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: {
        enrollment: { courseId: "course-1" },
        automationRule: { planKey: { in: ["whatsapp_group"] } },
        status: { in: ["PROGRAMADO", "FALLIDO"] },
      },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "COMMUNICATION_LINK_CHANGING", nextAttemptAt: null }),
    });
    expect(body.quarantined).toBe(2);
  });

  it("cambiar courseCompleteUrl afecta course_complete Y course_follow_up juntos", async () => {
    await peticion("course-1", { courseCompleteUrl: "https://ra-training.com/gracias", confirm: true });
    const { where } = mocks.tx.outboundMessage.updateMany.mock.calls[0][0];
    expect(where.automationRule.planKey.in.sort()).toEqual(["course_complete", "course_follow_up"]);
  });

  it("cambiar surveyUrl solo afecta survey", async () => {
    await peticion("course-1", { surveyUrl: "https://forms.example.com/x", confirm: true });
    const { where } = mocks.tx.outboundMessage.updateMany.mock.calls[0][0];
    expect(where.automationRule.planKey.in).toEqual(["survey"]);
  });

  it("cambiar dos enlaces a la vez pone en cuarentena la unión de sus momentos", async () => {
    await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/x", surveyUrl: "https://forms.example.com/x", confirm: true });
    const { where } = mocks.tx.outboundMessage.updateMany.mock.calls[0][0];
    expect(where.automationRule.planKey.in.sort()).toEqual(["survey", "whatsapp_group"]);
  });

  it("después de guardar, reprograma el curso para recuperar lo que estaba OMITIDO por falta de enlace", async () => {
    const res = await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/x", confirm: true });
    const body = await res.json();
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
    expect(body.reconciled).toBeDefined();
  });

  it("marca el curso pendiente de reconciliación dentro de la misma transacción", async () => {
    await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/x", confirm: true });
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "COMMUNICATION_LINKS_CHANGED" },
    });
  });

  it("si la reprogramación falla dos veces, la respuesta igual confirma que el enlace se guardó, marcada pendiente", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto conexión perdida"));
    const res = await peticion("course-1", { whatsappGroupUrl: "https://chat.whatsapp.com/x", confirm: true });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, changed: true, pending: true });
    expect(JSON.stringify(body)).not.toMatch(/secreto/);
  });
});

describe("validación", () => {
  it("una URL mal formada se rechaza y no toca la base", async () => {
    const res = await peticion("course-1", { whatsappGroupUrl: "no-es-una-url", confirm: true });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.errorCode).toBe("LINK_INVALID");
    expect(mocks.tx.course.update).not.toHaveBeenCalled();
  });

  it("un cuerpo vacío se rechaza", async () => {
    const res = await peticion("course-1", { confirm: true });
    expect(res.status).toBe(422);
    expect(mocks.tx.course.update).not.toHaveBeenCalled();
  });

  it("un curso inexistente responde 404", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const res = await peticion("curso-fantasma", { surveyUrl: "https://forms.example.com/x", confirm: true });
    expect(res.status).toBe(404);
    expect(mocks.tx.course.update).not.toHaveBeenCalled();
  });
});

describe("confirm obligatorio", () => {
  it("sin confirm se rechaza y no toca la base", async () => {
    const res = await peticion("course-1", { surveyUrl: "https://forms.example.com/x" });
    expect(res.status).toBe(422);
    expect(mocks.tx.course.update).not.toHaveBeenCalled();
  });

  it("confirm:false se rechaza igual que si faltara", async () => {
    const res = await peticion("course-1", { surveyUrl: "https://forms.example.com/x", confirm: false });
    expect(res.status).toBe(422);
    expect(mocks.tx.course.update).not.toHaveBeenCalled();
  });

  it("confirm:true con al menos un enlace funciona", async () => {
    const res = await peticion("course-1", { surveyUrl: "https://forms.example.com/x", confirm: true });
    expect(res.status).toBe(200);
    // Dos escrituras a Course en la misma transacción: los enlaces y la
    // marca de reconciliación pendiente.
    expect(mocks.tx.course.update).toHaveBeenCalledTimes(2);
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
