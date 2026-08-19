// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn() },
    automationRule: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
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

import { POST } from "./route";

const FUTURO = { startsAt: new Date(Date.now() + 10 * 86_400_000), endsAt: new Date(Date.now() + 10 * 86_400_000 + 3_600_000), sessions: [] };
const VENCIDO = { startsAt: new Date(Date.now() - 10 * 86_400_000), endsAt: new Date(Date.now() - 10 * 86_400_000 + 3_600_000), sessions: [] };

function peticion(courseId: string, planKey: string, body: Record<string, unknown>) {
  return POST(
    new Request(`https://crm.example.test/api/admin/courses/${courseId}/communications/${planKey}/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: courseId, planKey }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", ...FUTURO });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.create.mockImplementation(async ({ data }: any) => ({ id: "rule-new", ...data }));
  mocks.prisma.automationRule.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mocks.rescheduleCourseAutomations.mockResolvedValue({ enrollments: 1, enqueued: 1, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false, nextCursor: null });
});

describe("seguridad y validación", () => {
  it("sin sesión válida no llega a tocar la base", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion("course-1", "whatsapp_group", { channels: ["WHATSAPP"], confirm: true });
    expect(res.status).toBe(401);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
  });

  it("sin confirm se rechaza", async () => {
    const res = await peticion("course-1", "whatsapp_group", { channels: ["WHATSAPP"] });
    expect(res.status).toBe(422);
    expect(mocks.prisma.automationRule.create).not.toHaveBeenCalled();
  });

  it("confirm:false se rechaza", async () => {
    const res = await peticion("course-1", "whatsapp_group", { channels: ["WHATSAPP"], confirm: false });
    expect(res.status).toBe(422);
  });

  it("sin canales se rechaza", async () => {
    const res = await peticion("course-1", "whatsapp_group", { channels: [], confirm: true });
    expect(res.status).toBe(422);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
  });

  it("un canal que no es EMAIL/WHATSAPP se rechaza", async () => {
    const res = await peticion("course-1", "whatsapp_group", { channels: ["SMS"], confirm: true });
    expect(res.status).toBe(422);
  });

  it("certification_offer (el paso #12) se rechaza: no vive en este flujo", async () => {
    const res = await peticion("course-1", "certification_offer", { channels: ["WHATSAPP"], confirm: true });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.errorCode).toBe("STEP_UNKNOWN");
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
  });

  it("un planKey inventado se rechaza", async () => {
    const res = await peticion("course-1", "paso-que-no-existe", { channels: ["WHATSAPP"], confirm: true });
    expect(res.status).toBe(422);
    expect((await res.json()).errorCode).toBe("STEP_UNKNOWN");
  });

  it("un curso inexistente responde 404 y no crea nada", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const res = await peticion("curso-fantasma", "whatsapp_group", { channels: ["WHATSAPP"], confirm: true });
    expect(res.status).toBe(404);
    expect(mocks.prisma.automationRule.create).not.toHaveBeenCalled();
  });
});

describe("contenido siempre canónico, nunca el del cliente", () => {
  it("el payload no acepta body/subject/template arbitrarios: solo canales, offset y confirm", async () => {
    await peticion("course-1", "whatsapp_group", {
      channels: ["WHATSAPP"],
      confirm: true,
      body: "texto libre inventado",
      waTemplateName: "plantilla_falsa",
    } as any);
    const data = mocks.prisma.automationRule.create.mock.calls[0][0].data;
    expect(data.body).not.toBe("texto libre inventado");
    expect(data.waTemplateName).not.toBe("plantilla_falsa");
  });

  it("configura WhatsApp de whatsapp_group con la plantilla EXACTA aprobada en Meta", async () => {
    await peticion("course-1", "whatsapp_group", { channels: ["WHATSAPP"], confirm: true });
    const data = mocks.prisma.automationRule.create.mock.calls[0][0].data;
    expect(data.channel).toBe("WHATSAPP");
    expect(data.planKey).toBe("whatsapp_group");
    expect(data.waTemplateName).toBe(WHATSAPP_TEMPLATES.whatsapp_group.name);
    expect(data.waTemplateLanguage).toBe(WHATSAPP_TEMPLATES.whatsapp_group.language);
    expect(data.waTemplateBodyVars).toEqual(WHATSAPP_TEMPLATES.whatsapp_group.bodyVars);
    expect(data.status).toBe("ACTIVE");
  });

  it("configura el correo estándar de whatsapp_group cuando el canal es EMAIL", async () => {
    await peticion("course-1", "whatsapp_group", { channels: ["EMAIL"], confirm: true });
    const data = mocks.prisma.automationRule.create.mock.calls[0][0].data;
    expect(data.channel).toBe("EMAIL");
    expect(data.subject).toBe("Informacion inicial de {{curso}}");
    expect(data.waTemplateName).toBeNull();
  });

  it("crea la regla ya ACTIVE: quien configura decidió explícitamente enviar", async () => {
    await peticion("course-1", "welcome", { channels: ["EMAIL", "WHATSAPP"], confirm: true });
    for (const call of mocks.prisma.automationRule.create.mock.calls) {
      expect(call[0].data.status).toBe("ACTIVE");
    }
  });

  it("no fija createdAt/updatedAt a mano: los pone Prisma, que es lo que alimenta la guarda de no-retroactividad", async () => {
    await peticion("course-1", "welcome", { channels: ["EMAIL"], confirm: true });
    const data = mocks.prisma.automationRule.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("createdAt");
    expect(data).not.toHaveProperty("updatedAt");
  });
});

describe("timing", () => {
  it("sin offsetMinutes usa el desfase por defecto del plan estándar", async () => {
    await peticion("course-1", "reminder_24h", { channels: ["EMAIL"], confirm: true });
    expect(mocks.prisma.automationRule.create.mock.calls[0][0].data.offsetMinutes).toBe(24 * 60);
  });

  it("con offsetMinutes personalizado, lo usa en vez del default", async () => {
    await peticion("course-1", "reminder_24h", { channels: ["EMAIL"], offsetMinutes: 90, confirm: true });
    expect(mocks.prisma.automationRule.create.mock.calls[0][0].data.offsetMinutes).toBe(90);
  });

  it("con sesión futura, sí calcula una próxima ejecución", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", ...FUTURO });
    await peticion("course-1", "reminder_24h", { channels: ["EMAIL"], confirm: true });
    expect(mocks.prisma.automationRule.create.mock.calls[0][0].data.nextExecutionAt).toBeInstanceOf(Date);
  });

  it("con sesión ya vencida, no revive: no calcula ejecución para un momento pasado", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", ...VENCIDO });
    await peticion("course-1", "reminder_24h", { channels: ["EMAIL"], confirm: true });
    expect(mocks.prisma.automationRule.create.mock.calls[0][0].data.nextExecutionAt).toBeNull();
  });
});

describe("idempotencia", () => {
  it("doble configure no duplica: un canal ya ACTIVE no se vuelve a crear", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([{ id: "rule-1", channel: "WHATSAPP", status: "ACTIVE" }]);
    const res = await peticion("course-1", "whatsapp_group", { channels: ["WHATSAPP"], confirm: true });
    const json = await res.json();
    expect(mocks.prisma.automationRule.create).not.toHaveBeenCalled();
    expect(mocks.prisma.automationRule.update).not.toHaveBeenCalled();
    expect(json.alreadyConfigured).toEqual(["WHATSAPP"]);
  });

  it("un canal ARCHIVED se revive con contenido fresco en vez de duplicarse", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([{ id: "rule-old", channel: "WHATSAPP", status: "ARCHIVED" }]);
    const res = await peticion("course-1", "whatsapp_group", { channels: ["WHATSAPP"], confirm: true });
    const json = await res.json();
    expect(mocks.prisma.automationRule.create).not.toHaveBeenCalled();
    expect(mocks.prisma.automationRule.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "rule-old" } }));
    expect(mocks.prisma.automationRule.update.mock.calls[0][0].data.status).toBe("ACTIVE");
    expect(json.revived).toEqual(["WHATSAPP"]);
  });

  it("dos peticiones concurrentes por el mismo canal: la segunda choca contra el unique y se trata como ya configurada, no como error", async () => {
    const choqueUnico = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    mocks.prisma.automationRule.create.mockRejectedValueOnce(choqueUnico);
    const res = await peticion("course-1", "whatsapp_group", { channels: ["WHATSAPP"], confirm: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alreadyConfigured).toEqual(["WHATSAPP"]);
    expect(json.created).toEqual([]);
  });

  it("un error de base de datos que no es de unicidad no se traga: se propaga", async () => {
    mocks.prisma.automationRule.create.mockRejectedValueOnce(new Error("conexión perdida"));
    await expect(peticion("course-1", "whatsapp_group", { channels: ["WHATSAPP"], confirm: true })).rejects.toThrow("conexión perdida");
  });
});

describe("reprogramación y auditoría", () => {
  it("crea y reprograma una sola vez cuando hay cambios", async () => {
    await peticion("course-1", "welcome", { channels: ["EMAIL", "WHATSAPP"], confirm: true });
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(1);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");
  });

  it("si no hubo ningún cambio (todo ya estaba configurado), no reprograma", async () => {
    mocks.prisma.automationRule.findMany.mockResolvedValue([
      { id: "r1", channel: "EMAIL", status: "ACTIVE" },
      { id: "r2", channel: "WHATSAPP", status: "ACTIVE" },
    ]);
    await peticion("course-1", "welcome", { channels: ["EMAIL", "WHATSAPP"], confirm: true });
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("un fallo de reschedule no revierte lo creado, y no expone el mensaje crudo del error en la auditoría", async () => {
    mocks.rescheduleCourseAutomations.mockRejectedValueOnce(new Error("postgres://admin:hunter2@10.0.0.5/prod"));
    const res = await peticion("course-1", "welcome", { channels: ["EMAIL"], confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.automationRule.create).toHaveBeenCalledTimes(1);
    const fallo = mocks.writeAudit.mock.calls.find((call: any) => call[0].result === "FAILURE");
    expect(fallo?.[0].action).toBe("COURSE_COMMUNICATION_STEP_RESCHEDULE_FAILED");
    const todaLaAuditoria = JSON.stringify(mocks.writeAudit.mock.calls);
    expect(todaLaAuditoria).not.toContain("hunter2");
  });

  it("registra la auditoría de configuración con los canales tocados", async () => {
    await peticion("course-1", "welcome", { channels: ["EMAIL"], confirm: true });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "COURSE_COMMUNICATION_STEP_CONFIGURED",
      entityType: "Course",
      entityId: "course-1",
      metadata: expect.objectContaining({ planKey: "welcome", created: ["EMAIL"] }),
    }));
  });
});

describe("alcance por curso", () => {
  it("busca y crea reglas solo del curso pedido", async () => {
    await peticion("course-9", "welcome", { channels: ["EMAIL"], confirm: true });
    expect(mocks.prisma.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ courseId: "course-9", planKey: "welcome" }),
    }));
    expect(mocks.prisma.automationRule.create.mock.calls[0][0].data.courseId).toBe("course-9");
  });
});
