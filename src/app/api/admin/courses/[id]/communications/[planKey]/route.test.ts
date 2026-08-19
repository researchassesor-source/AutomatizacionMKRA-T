// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn() },
    automationRule: { findMany: vi.fn(), updateMany: vi.fn() },
    outboundMessage: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  writeAudit: vi.fn(async (_input: any) => undefined),
  requireRole: vi.fn(async (): Promise<{ session: { userId: string; email: string; role: string } | null; error: Response | null }> => ({
    session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" },
    error: null,
  })),
  rescheduleCourseAutomations: vi.fn(async () => ({ enrollments: 1, enqueued: 1, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false, nextCursor: null })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));

import { PATCH } from "./route";

/**
 * Toggle operativo de un paso del recorrido.
 *
 * El riesgo concreto: apagar un paso deja el correo en PAUSED y el WhatsApp en
 * ACTIVE por un fallo a mitad, o al encender uno se cuela un mensaje de otro
 * curso. Por eso se comprueba el `where` exacto que recibe cada escritura, no
 * solo el código de respuesta.
 */
function peticion(courseId: string, planKey: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/communications/${planKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId, planKey }) },
  );
}

/** Simula la transacción ejecutando el callback con un `tx` que refleja las mismas tablas. */
function conectarTransaccion() {
  mocks.prisma.$transaction.mockImplementation(async (fn: any) => fn({
    automationRule: { updateMany: mocks.prisma.automationRule.updateMany },
    outboundMessage: { updateMany: mocks.prisma.outboundMessage.updateMany },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
  mocks.prisma.automationRule.findMany.mockResolvedValue([
    { id: "rule-email", status: "ACTIVE" },
    { id: "rule-wa", status: "ACTIVE" },
  ]);
  mocks.prisma.automationRule.updateMany.mockResolvedValue({ count: 2 });
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.rescheduleCourseAutomations.mockResolvedValue({ enrollments: 1, enqueued: 1, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false, nextCursor: null });
  conectarTransaccion();
});

describe("apagar un paso", () => {
  it("pasa a PAUSED las dos reglas del planKey en la misma transacción", async () => {
    const res = await peticion("course-1", "reminder_24h", { enabled: false, confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.automationRule.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rule-email", "rule-wa"] } },
      data: { status: "PAUSED" },
    });
    // Una sola llamada a $transaction: correo y WhatsApp no pueden quedar en
    // estados distintos por un fallo a mitad de camino.
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("pausa (no cancela) solo los mensajes PROGRAMADO de esas reglas, no el historial", async () => {
    await peticion("course-1", "reminder_24h", { enabled: false, confirm: true });
    // Recuperable, no CANCELADO: rescheduleCourseAutomations puede reprogramar
    // un OMITIDO cuyo momento siga en el futuro si el paso se reactiva.
    expect(mocks.prisma.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { automationRuleId: { in: ["rule-email", "rule-wa"] }, status: "PROGRAMADO" },
      data: { status: "OMITIDO", errorCode: "RULE_PAUSED", errorMessage: expect.any(String) },
    });
  });

  it("no reprograma el curso al apagar", async () => {
    await peticion("course-1", "reminder_24h", { enabled: false, confirm: true });
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });
});

describe("encender un paso", () => {
  it("pasa a ACTIVE y reprograma el curso una sola vez", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([{ id: "rule-email", status: "PAUSED" }]);
    const res = await peticion("course-1", "welcome", { enabled: true, confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.automationRule.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rule-email"] } },
      data: { status: "ACTIVE", activatedAt: expect.any(Date) },
    });
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(1);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");
  });

  it("no cancela mensajes al encender", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([{ id: "rule-email", status: "PAUSED" }]);
    await peticion("course-1", "welcome", { enabled: true, confirm: true });
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  it("si el reschedule falla, el estado ya guardado NO se revierte", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([{ id: "rule-email", status: "PAUSED" }]);
    mocks.rescheduleCourseAutomations.mockRejectedValueOnce(new Error("timeout"));
    const res = await peticion("course-1", "welcome", { enabled: true, confirm: true });
    const json = await res.json();
    // La respuesta sigue confirmando el cambio: la elección de quien
    // administra ya está guardada, y el reloj recupera el reschedule después.
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, enabled: true });
    expect(mocks.prisma.automationRule.updateMany).toHaveBeenCalledTimes(1);
    // El fallo queda auditado, sin exponer detalles del error al cliente.
    const fallos = mocks.writeAudit.mock.calls.filter((call: any) => call[0].result === "FAILURE");
    expect(fallos).toHaveLength(1);
  });

  it("un error de reschedule con texto sensible nunca llega a la auditoría, y se guarda bajo una acción propia", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([{ id: "rule-email", status: "PAUSED" }]);
    const secreto = "connection refused at postgres://admin:hunter2@10.0.0.5:5432/prod\n  at Object.<anonymous> (/srv/app/db.ts:42:11)";
    mocks.rescheduleCourseAutomations.mockRejectedValueOnce(new Error(secreto));
    await peticion("course-1", "welcome", { enabled: true, confirm: true });

    const fallo = mocks.writeAudit.mock.calls.find((call: any) => call[0].result === "FAILURE");
    if (!fallo) throw new Error("no se registró ninguna auditoría con result FAILURE");
    expect(fallo[0].action).toBe("COURSE_COMMUNICATION_STEP_RESCHEDULE_FAILED");
    expect(fallo[0].metadata).toMatchObject({ courseId: "course-1", planKey: "welcome", enabled: true });
    // Ni el mensaje del Error ni ningun fragmento del texto sensible viajan en ningun registro de auditoria.
    const todaLaAuditoria = JSON.stringify(mocks.writeAudit.mock.calls);
    expect(todaLaAuditoria).not.toContain("hunter2");
    expect(todaLaAuditoria).not.toContain("postgres://");
    expect(todaLaAuditoria).not.toContain("/srv/app/db.ts");
    expect(todaLaAuditoria).not.toMatch(/connection refused/i);

    // El cambio de estado del paso queda como un hecho aparte, con su propia acción normal.
    const actualizado = mocks.writeAudit.mock.calls.find((call: any) => call[0].action === "COURSE_COMMUNICATION_STEP_UPDATED");
    if (!actualizado) throw new Error("no se registró la auditoría COURSE_COMMUNICATION_STEP_UPDATED");
    expect(actualizado[0].result).not.toBe("FAILURE");
  });
});

describe("draft safety: una regla DRAFT nunca se activa por accidente", () => {
  it("al encender, una regla DRAFT del mismo planKey no se promueve aunque su hermana ya estuviera ACTIVE", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([
      { id: "rule-email", status: "ACTIVE" },
      { id: "rule-wa", status: "DRAFT" },
    ]);
    const res = await peticion("course-1", "welcome", { enabled: true, confirm: true });
    expect(res.status).toBe(200);
    // No hay ninguna PAUSED que promover, asi que updateMany de activacion ni se llama.
    expect(mocks.prisma.automationRule.updateMany).not.toHaveBeenCalled();
  });

  it("al encender con una mezcla de PAUSED y DRAFT, solo la PAUSED pasa a ACTIVE", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([
      { id: "rule-email", status: "PAUSED" },
      { id: "rule-wa", status: "DRAFT" },
    ]);
    await peticion("course-1", "welcome", { enabled: true, confirm: true });
    expect(mocks.prisma.automationRule.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rule-email"] } },
      data: { status: "ACTIVE", activatedAt: expect.any(Date) },
    });
  });

  it("al apagar, tanto la ACTIVE como la DRAFT quedan PAUSED por igual", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([
      { id: "rule-email", status: "ACTIVE" },
      { id: "rule-wa", status: "DRAFT" },
    ]);
    await peticion("course-1", "welcome", { enabled: false, confirm: true });
    expect(mocks.prisma.automationRule.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rule-email", "rule-wa"] } },
      data: { status: "PAUSED" },
    });
  });
});

describe("no configurado / no existe", () => {
  it("un planKey fuera de los once se rechaza sin tocar la base", async () => {
    const res = await peticion("course-1", "certification_offer", { enabled: true, confirm: true });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.errorCode).toBe("STEP_UNKNOWN");
    expect(mocks.prisma.automationRule.findMany).not.toHaveBeenCalled();
  });

  it("un curso inexistente responde 404", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const res = await peticion("curso-fantasma", "welcome", { enabled: true, confirm: true });
    expect(res.status).toBe(404);
  });

  it("un paso sin ninguna regla configurada responde 409 y no crea nada", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([]);
    const res = await peticion("course-1", "survey", { enabled: true, confirm: true });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.errorCode).toBe("STEP_NOT_CONFIGURED");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("aislamiento entre pasos y cursos", () => {
  it("apagar un planKey no toca las reglas de otro planKey del mismo curso", async () => {
    await peticion("course-1", "reminder_24h", { enabled: false, confirm: true });
    expect(mocks.prisma.automationRule.findMany).toHaveBeenCalledWith({
      where: { courseId: "course-1", planKey: "reminder_24h", status: { not: "ARCHIVED" } },
      select: { id: true, status: true },
    });
  });

  it("apagar un paso de un curso no puede manipular reglas de otro curso", async () => {
    // El id del curso viene de la ruta, no del cuerpo: no hay forma de que la
    // petición apunte a un courseId distinto al de la URL.
    await peticion("course-9", "reminder_24h", { enabled: false, confirm: true });
    expect(mocks.prisma.automationRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ courseId: "course-9" }) }),
    );
  });
});

describe("seguridad", () => {
  it("sin sesión válida no llega a tocar la base", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion("course-1", "welcome", { enabled: true, confirm: true });
    expect(res.status).toBe(401);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
  });

  it("sin confirm explícito se rechaza", async () => {
    const res = await peticion("course-1", "welcome", { enabled: true });
    expect(res.status).toBe(422);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
  });

  it("registra la auditoría con el motivo, sin cuerpos de mensaje", async () => {
    await peticion("course-1", "reminder_24h", { enabled: false, confirm: true });
    const metadata = mocks.writeAudit.mock.calls[0][0].metadata;
    expect(metadata).toMatchObject({ planKey: "reminder_24h", enabled: false, ruleCount: 2 });
    expect(JSON.stringify(metadata)).not.toMatch(/subject|body/i);
  });
});
