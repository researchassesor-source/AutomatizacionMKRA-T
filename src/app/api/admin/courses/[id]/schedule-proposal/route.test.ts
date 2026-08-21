// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles de Prisma usan objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarRevisionOf } from "@/lib/course-schedule-reconciliation";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    course: { update: vi.fn() },
    courseSession: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    outboundMessage: { updateMany: vi.fn() },
  },
  rescheduleCourseAutomations: vi.fn(),
  reprogramarOfertaAutomatica: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
  proponerCalendario: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
// A propósito NO se expone courseSession en el cliente prisma de nivel
// superior: si la ruta alguna vez leyera las sesiones fuera de la
// transacción (el riesgo de condición de carrera señalado en la revisión),
// esa llamada explotaría aquí en vez de pasar inadvertida.
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));
vi.mock("@/lib/commerce/offer-campaign", () => ({ reprogramarOfertaAutomatica: mocks.reprogramarOfertaAutomatica }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/course-schedule-parser", () => ({ proponerCalendario: mocks.proponerCalendario }));

import { GET, POST } from "./route";

function getRequest() {
  return new Request("https://crm.example.test/api/admin/courses/course-1/schedule-proposal", { cache: "no-store" });
}
function postRequest(body: unknown) {
  return new Request("https://crm.example.test/api/admin/courses/course-1/schedule-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ id: "course-1" }) };
}

type StoredMessage = {
  id: string;
  courseSessionId: string | null;
  channel?: "EMAIL" | "WHATSAPP";
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  cancelledAt: Date | null;
  nextAttemptAt: Date | null;
};
let messages: StoredMessage[];

const s = (id: string, startAt: string, endAt: string | null = null) => ({ id, startAt: new Date(startAt), endAt: endAt ? new Date(endAt) : null });

beforeEach(() => {
  vi.clearAllMocks();
  messages = [];
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.rescheduleCourseAutomations.mockResolvedValue({ enrollments: 0, enqueued: 0, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false });
  mocks.reprogramarOfertaAutomatica.mockResolvedValue(null);
  mocks.prisma.course.update.mockResolvedValue({});
  mocks.prisma.course.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.tx.course.update.mockResolvedValue({});
  mocks.tx.outboundMessage.updateMany.mockImplementation(async ({ where, data }: any) => {
    const statusIn: string[] | undefined = where.status?.in;
    const sessionIn: string[] | undefined = where.courseSessionId?.in;
    let count = 0;
    for (const message of messages) {
      if (statusIn && !statusIn.includes(message.status)) continue;
      if (sessionIn && !(message.courseSessionId !== null && sessionIn.includes(message.courseSessionId))) continue;
      Object.assign(message, data);
      count++;
    }
    return { count };
  });
  mocks.proponerCalendario.mockReturnValue({ ok: true, sessions: [{ startAt: "2026-08-27T00:30:00.000Z", endAt: null }], fuenteInicio: "26 de agosto", fuenteHorario: "7:30 pm", horaAsumida: false });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>placeholder</html>", { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET schedule-proposal: clasificación e identidad del calendario", () => {
  it("devuelve calendarRevision junto al status", async () => {
    const sessions = [{ id: "s1", startAt: new Date("2026-08-18T00:30:00.000Z"), endAt: null }];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null, sessions });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("CALENDARIO_CAMBIADO");
    expect(body.calendarRevision).toBe(calendarRevisionOf(sessions));
  });

  it("SIN_CALENDARIO_CRM cuando el curso todavía no tiene ninguna sesión", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null, sessions: [] });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("SIN_CALENDARIO_CRM");
    expect(body.calendarRevision).toBe(calendarRevisionOf([]));
  });

  it("CALENDARIO_IGUAL cuando coincide exactamente", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null,
      sessions: [{ id: "s1", startAt: new Date("2026-08-27T00:30:00.000Z"), endAt: null }],
    });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("CALENDARIO_IGUAL");
  });

  it("SIN_FECHA_EN_WORDPRESS cuando la página no anuncia fecha", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null, sessions: [] });
    mocks.proponerCalendario.mockReturnValue({ ok: false, motivo: "La página todavía no anuncia fechas.", fuenteInicio: "Próximamente", fuenteHorario: null });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("SIN_FECHA_EN_WORDPRESS");
  });

  it("ERROR cuando la página no responde", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null, sessions: [] });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("ERROR");
  });
});

describe("POST schedule-proposal: 9 - confirmación literal obligatoria", () => {
  it("sin el literal APPLY_WORDPRESS_SCHEDULE responde 422 y no toca la base de datos", async () => {
    const response = await POST(postRequest({ calendarRevision: "x", sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }] }), params());
    expect(response.status).toBe(422);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("el confirm:true del contrato anterior ya NO es válido", async () => {
    const response = await POST(postRequest({ confirm: true, calendarRevision: "x", sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }] }), params());
    expect(response.status).toBe(422);
  });

  it("sin calendarRevision responde 422", async () => {
    const response = await POST(postRequest({ confirm: "APPLY_WORDPRESS_SCHEDULE", sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }] }), params());
    expect(response.status).toBe(422);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST schedule-proposal: 5/6 - la revisión del calendario protege contra sobrescritura", () => {
  it("5: calendarRevision desactualizada aborta con 409 y cero mutaciones", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue([s("s1", "2026-08-18T00:00:00.000Z")]);

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: "revision-vieja-incorrecta",
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "El calendario cambió mientras lo revisabas. Vuelve a sincronizar antes de aplicarlo." });
    expect(mocks.tx.courseSession.update).not.toHaveBeenCalled();
    expect(mocks.tx.courseSession.create).not.toHaveBeenCalled();
    expect(mocks.tx.courseSession.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.outboundMessage.updateMany).not.toHaveBeenCalled();
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("6: calendarRevision correcta procede con normalidad", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());

    expect(response.status).toBe(200);
    expect(mocks.tx.courseSession.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { startAt: new Date("2026-08-26T00:00:00.000Z"), endAt: null } });
  });

  it("7: la lectura de sesiones para el plan ocurre dentro de la transacción (tx), no antes", async () => {
    // prisma.courseSession no existe en el mock: si la ruta llamara a
    // prisma.courseSession.findMany en vez de tx.courseSession.findMany, esto
    // explotaría con un TypeError en vez de pasar inadvertido.
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());

    expect(response.status).toBe(200);
    expect(mocks.tx.courseSession.findMany).toHaveBeenCalledWith({ where: { courseId: "course-1" }, select: { id: true, startAt: true, endAt: true } });
  });

  it("la transacción usa aislamiento Serializable", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);
    await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
  });
});

describe("POST schedule-proposal: 1/2/8 - cuarentena antes de mover la fecha, cancelación al eliminar", () => {
  it("1: un PROGRAMADO de la sesión actualizada se pone en cuarentena ANTES de mover la fecha, y sale reprogramado tras el reschedule", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    messages.push({ id: "m-pendiente", courseSessionId: "s1", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: new Date() });
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());

    expect(response.status).toBe(200);
    const pendiente = messages.find((m) => m.id === "m-pendiente");
    // La cuarentena SÍ se aplicó (se ve en el store en memoria); como el
    // reschedule mockeado no lo vuelve a tocar, queda visible en ese estado.
    expect(pendiente?.status).toBe("OMITIDO");
    expect(pendiente?.errorCode).toBe("SCHEDULE_RECONCILING");
    expect(pendiente?.errorMessage).toBe("El calendario cambió y este aviso está esperando ser recalculado.");
    expect(pendiente?.nextAttemptAt).toBeNull();
    // La sesión igual se actualizó: el motor, al llamarse después, es quien
    // recalcula sobre la fecha nueva.
    expect(mocks.tx.courseSession.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { startAt: new Date("2026-08-26T00:00:00.000Z"), endAt: null } });
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });

  /**
   * Prueba D de la continuación arquitectónica: cambiar la fecha de UNA
   * sesión desplaza "sesión X de Y" para las demás -3 sesiones, cambiar la
   * del medio puede reordenarlas-. Un mensaje de una sesión que WordPress NO
   * tocó directamente tiene que quedar igual de protegido.
   */
  it("D: un mensaje de una sesión que WordPress NO tocó directamente igual queda protegido (todo el curso, no solo la sesión editada)", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z"), s("s3", "2026-08-20T00:00:00.000Z")];
    messages.push({ id: "m-de-s1-no-tocada", courseSessionId: "s1", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: null });
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);

    // Solo s2 cambia de HORA (sigue entre s1 y s3 al ordenar, así que no
    // desplaza la posición de nadie): s1 y s3 se proponen exactamente igual.
    await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [
        { startAt: "2026-08-18T00:00:00.000Z", endAt: null },
        { startAt: "2026-08-19T12:00:00.000Z", endAt: null },
        { startAt: "2026-08-20T00:00:00.000Z", endAt: null },
      ],
    }), params());

    const deS1 = messages.find((m) => m.id === "m-de-s1-no-tocada");
    expect(deS1?.status).toBe("OMITIDO");
    expect(deS1?.errorCode).toBe("SCHEDULE_RECONCILING");
  });

  it("la cuarentena ocurre ANTES de mover la fecha de la sesión (orden de las llamadas)", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    messages.push({ id: "m-pendiente", courseSessionId: "s1", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: null });
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);
    await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());
    const cuarentenaOrder = mocks.tx.outboundMessage.updateMany.mock.invocationCallOrder[0];
    const updateOrder = mocks.tx.courseSession.update.mock.invocationCallOrder[0];
    expect(cuarentenaOrder).toBeLessThan(updateOrder);
  });

  it("2: un mensaje ENVIADO de la misma sesión nunca se toca", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    messages.push(
      { id: "m-enviado", courseSessionId: "s1", status: "ENVIADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: null },
      { id: "m-pendiente", courseSessionId: "s1", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: null },
    );
    const snapshotEnviado = { ...messages[0] };
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);

    await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());

    expect(messages.find((m) => m.id === "m-enviado")).toEqual(snapshotEnviado);
    expect(messages.find((m) => m.id === "m-pendiente")?.status).toBe("OMITIDO");
  });

  it("8: una sesión eliminada cancela sus pendientes (SESSION_REMOVED), no los pone en SCHEDULE_RECONCILING", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z")];
    messages.push({ id: "m-en-la-sobrante", courseSessionId: "s2", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: null });
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-18T00:00:00.000Z", endAt: null }],
    }), params());
    const body = await response.json();

    expect(body.removed).toBe(1);
    const eliminado = messages.find((m) => m.id === "m-en-la-sobrante");
    expect(eliminado?.status).toBe("CANCELADO");
    expect(eliminado?.errorCode).toBe("SESSION_REMOVED");
    expect(mocks.tx.courseSession.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s2"] } } });
  });
});

describe("POST schedule-proposal: 3/4 - reconciliación durable si rescheduleCourseAutomations falla", () => {
  it("3: reschedule falla dos veces -> 200 igual (el calendario SÍ se aplicó), pending:true, sin filtrar la excepción; el cron lo recupera después", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("token=secreto conexión perdida en la línea 42"));

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());

    // Ya no hace falta un 503 que exija reintentar a mano: el flag persistente
    // (Course.automationReconcilePendingAt) y el cron se encargan solos.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, pending: true, reconciled: { ok: false, pending: true } });
    expect(JSON.stringify(body)).not.toMatch(/secreto|línea 42/);
    // El calendario YA se guardó: no se puede decir "no se aplicó ningún cambio".
    expect(mocks.tx.courseSession.update).toHaveBeenCalled();
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(2);
    // El flag quedó marcado dentro de la MISMA transacción que movió la fecha.
    expect(mocks.tx.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: expect.any(Date), automationReconcileReason: "WORDPRESS_CALENDAR_APPLIED" },
    });
  });

  it("un solo fallo transitorio se recupera con el reintento (como máximo 2 intentos)", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);
    mocks.rescheduleCourseAutomations
      .mockRejectedValueOnce(new Error("timeout transitorio"))
      .mockResolvedValueOnce({ enrollments: 1, enqueued: 0, updated: 1, omitted: 0, cancelled: 0, batches: 1, truncated: false });

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());

    expect(response.status).toBe(200);
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledTimes(2);
  });

  it("4: reaplicar el mismo calendario ya vigente igual ejecuta reschedule (recupera SCHEDULE_RECONCILING pendiente de antes)", async () => {
    const existing = [s("s1", "2026-08-26T00:00:00.000Z")];
    // Sin cambios de sesión que hacer: el calendario confirmado ya coincide.
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());
    const body = await response.json();

    expect(body.updated).toBe(0);
    expect(body.removed).toBe(0);
    expect(body.created).toBe(0);
    expect(mocks.tx.courseSession.update).not.toHaveBeenCalled();
    // Aun sin nada que reconciliar en las sesiones, reschedule se llama
    // igual: es lo único que puede recuperar un SCHEDULE_RECONCILING que
    // haya quedado de un intento anterior fallido.
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
  });
});

/**
 * Cierre de producción: la transición real de "IA para la Planificación
 * Educativa" en ra-training.com, de 18/19/20 a 26/27/28 de agosto (Sección
 * A del parser prueba que el HTML real de esas tres fechas produce
 * exactamente estos ISO; aquí se prueba que esos ISO, ya aplicados, mueven
 * TODAS las capas derivadas -sesiones, Course.startsAt/endsAt, cola
 * PROGRAMADO de ambos canales, #12, el flag de reconciliación- y ninguna
 * toca lo ya enviado).
 */
describe("POST schedule-proposal: transición real 18/19/20 → 26/27/28 (Sección A+B, cierre de producción)", () => {
  it("actualiza las tres sesiones preservando id, Course.startsAt/endsAt, la cola de ambos canales, respeta lo ya enviado, reprograma #12 y limpia el flag al terminar con éxito", async () => {
    const existing = [
      s("s1", "2026-08-18T00:30:00.000Z"),
      s("s2", "2026-08-19T00:30:00.000Z"),
      s("s3", "2026-08-20T00:30:00.000Z"),
    ];
    // Exactamente lo que produce proponerCalendario sobre el HTML real
    // capturado en course-schedule-parser.test.ts para 26/27/28 de agosto,
    // 7:00-9:00 pm Ecuador.
    const nuevasFechas = [
      { startAt: "2026-08-27T00:00:00.000Z", endAt: "2026-08-27T02:00:00.000Z" }, // 26 ago 19:00-21:00 EC
      { startAt: "2026-08-28T00:00:00.000Z", endAt: "2026-08-28T02:00:00.000Z" }, // 27 ago 19:00-21:00 EC
      { startAt: "2026-08-29T00:00:00.000Z", endAt: "2026-08-29T02:00:00.000Z" }, // 28 ago 19:00-21:00 EC
    ];
    messages.push(
      { id: "m-email-pendiente", courseSessionId: "s1", channel: "EMAIL", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: new Date() },
      { id: "m-wa-pendiente", courseSessionId: "s3", channel: "WHATSAPP", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: new Date() },
      { id: "m-ya-enviado", courseSessionId: "s2", channel: "WHATSAPP", status: "ENVIADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: null },
    );
    const snapshotEnviado = { ...messages[2] };
    // Lectura POSTERIOR a la transacción (reconcileCourseDerivedState): ya ve
    // las sesiones con las fechas nuevas, para calcular Course.startsAt/endsAt.
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1",
      startsAt: new Date("2026-08-18T00:30:00.000Z"),
      endsAt: new Date("2026-08-20T00:30:00.000Z"),
      streamUrl: null,
      sessions: [
        { id: "s1", title: null, startAt: new Date(nuevasFechas[0].startAt), endAt: new Date(nuevasFechas[0].endAt), streamUrl: null, timezone: null },
        { id: "s2", title: null, startAt: new Date(nuevasFechas[1].startAt), endAt: new Date(nuevasFechas[1].endAt), streamUrl: null, timezone: null },
        { id: "s3", title: null, startAt: new Date(nuevasFechas[2].startAt), endAt: new Date(nuevasFechas[2].endAt), streamUrl: null, timezone: null },
      ],
    });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: nuevasFechas,
    }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pending).toBe(false);

    // 1/2: las tres sesiones existentes se actualizan por posición cronológica,
    // preservando su id -- ninguna se crea ni se borra (mismo conteo).
    expect(body.updated).toBe(3);
    expect(body.removed).toBe(0);
    expect(body.created).toBe(0);
    expect(mocks.tx.courseSession.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { startAt: new Date(nuevasFechas[0].startAt), endAt: new Date(nuevasFechas[0].endAt) } });
    expect(mocks.tx.courseSession.update).toHaveBeenCalledWith({ where: { id: "s2" }, data: { startAt: new Date(nuevasFechas[1].startAt), endAt: new Date(nuevasFechas[1].endAt) } });
    expect(mocks.tx.courseSession.update).toHaveBeenCalledWith({ where: { id: "s3" }, data: { startAt: new Date(nuevasFechas[2].startAt), endAt: new Date(nuevasFechas[2].endAt) } });
    expect(mocks.tx.courseSession.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.courseSession.create).not.toHaveBeenCalled();

    // 5/6: Course.startsAt = primera sesión real (26); Course.endsAt = fin de
    // la última (28, 21:00 EC).
    expect(body.reconciled.startsAt).toBe("2026-08-27T00:00:00.000Z");
    expect(body.reconciled.endsAt).toBe("2026-08-29T02:00:00.000Z");
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { startsAt: new Date("2026-08-27T00:00:00.000Z"), endsAt: new Date("2026-08-29T02:00:00.000Z") },
    });

    // 7/8: PROGRAMADO de los dos canales queda en cuarentena esperando el
    // recálculo (rescheduleCourseAutomations, ya probado a fondo en engine.ts,
    // se llama aquí como spy -- lo que se prueba es que la orquestación SÍ lo
    // invoca sobre este curso).
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1", expect.any(Date));
    const email = messages.find((m) => m.id === "m-email-pendiente");
    const wa = messages.find((m) => m.id === "m-wa-pendiente");
    expect(email?.status).toBe("OMITIDO");
    expect(email?.errorCode).toBe("SCHEDULE_RECONCILING");
    expect(wa?.status).toBe("OMITIDO");
    expect(wa?.errorCode).toBe("SCHEDULE_RECONCILING");

    // 9: lo ya ENVIADO, de cualquier canal, no se toca.
    expect(messages.find((m) => m.id === "m-ya-enviado")).toEqual(snapshotEnviado);

    // 11: oferta institucional #12 se reprograma como parte del mismo paquete.
    expect(mocks.reprogramarOfertaAutomatica).toHaveBeenCalledWith("course-1", expect.anything());

    // 12: el flag de reconciliación pendiente se limpia SOLO tras terminar
    // todo el paquete con éxito (rescheduleCourseAutomations + reglas fijas +
    // #12), no antes.
    expect(mocks.prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { automationReconcilePendingAt: null, automationReconcileReason: null },
    });
  });

  it("13: si el recálculo derivado falla, el calendario queda igual de aplicado y ambos canales quedan a salvo en cuarentena, no perdidos", async () => {
    const existing = [
      s("s1", "2026-08-18T00:30:00.000Z"),
      s("s2", "2026-08-19T00:30:00.000Z"),
      s("s3", "2026-08-20T00:30:00.000Z"),
    ];
    const nuevasFechas = [
      { startAt: "2026-08-27T00:00:00.000Z", endAt: "2026-08-27T02:00:00.000Z" },
      { startAt: "2026-08-28T00:00:00.000Z", endAt: "2026-08-28T02:00:00.000Z" },
      { startAt: "2026-08-29T00:00:00.000Z", endAt: "2026-08-29T02:00:00.000Z" },
    ];
    messages.push(
      { id: "m-email-pendiente", courseSessionId: "s1", channel: "EMAIL", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: new Date() },
      { id: "m-wa-pendiente", courseSessionId: "s3", channel: "WHATSAPP", status: "PROGRAMADO", errorCode: null, errorMessage: null, cancelledAt: null, nextAttemptAt: new Date() },
    );
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1", startsAt: null, endsAt: null, streamUrl: null, sessions: [] });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);
    mocks.rescheduleCourseAutomations.mockRejectedValue(new Error("timeout"));

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: nuevasFechas,
    }), params());
    const body = await response.json();

    // El calendario SÍ se aplicó -- no es "no se aplicó ningún cambio".
    expect(response.status).toBe(200);
    expect(body.updated).toBe(3);
    expect(mocks.tx.courseSession.update).toHaveBeenCalledTimes(3);
    // La reconciliación derivada queda pendiente; el cron la recupera después.
    expect(body.pending).toBe(true);
    expect(body.reconciled).toEqual({ ok: false, pending: true });
    // Ambos canales quedan OMITIDO/recuperable, nunca CANCELADO ni perdidos.
    expect(messages.find((m) => m.id === "m-email-pendiente")?.status).toBe("OMITIDO");
    expect(messages.find((m) => m.id === "m-wa-pendiente")?.status).toBe("OMITIDO");
    // El flag de reconciliación pendiente sigue marcado (nunca se limpió).
    expect(mocks.prisma.course.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ automationReconcilePendingAt: null }) }),
    );
  });
});

describe("POST schedule-proposal: fallo de transacción -> sin cambios reales", () => {
  it("si la transacción falla antes de comprometer nada, responde 500 sin decir que el calendario cambió", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.prisma.$transaction.mockImplementation(async () => {
      throw new Error("constraint violation");
    });

    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "No se pudo actualizar el calendario. No se aplicó ningún cambio." });
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

describe("POST schedule-proposal: casos generales ya cubiertos, siguen intactos", () => {
  it("A: crea desde cero cuando no había ninguna sesión", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue([]);
    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf([]),
      sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }],
    }), params());
    const body = await response.json();
    expect(body.created).toBe(1);
    expect(mocks.tx.courseSession.create).toHaveBeenCalledWith({ data: { courseId: "course-1", startAt: new Date("2026-08-26T00:30:00.000Z"), endAt: null } });
  });

  it("B: calendario idéntico no escribe ninguna sesión", async () => {
    const existing = [s("s1", "2026-08-26T00:30:00.000Z")];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);
    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }],
    }), params());
    const body = await response.json();
    expect(body).toMatchObject({ updated: 0, created: 0, removed: 0 });
    expect(mocks.tx.courseSession.update).not.toHaveBeenCalled();
    expect(mocks.tx.courseSession.deleteMany).not.toHaveBeenCalled();
  });

  it("G: crea la sesión nueva cuando el calendario crece", async () => {
    const existing = [s("s1", "2026-08-18T00:00:00.000Z")];
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue(existing);
    const response = await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf(existing),
      sessions: [{ startAt: "2026-08-18T00:00:00.000Z", endAt: null }, { startAt: "2026-08-19T00:00:00.000Z", endAt: null }],
    }), params());
    const body = await response.json();
    expect(body.created).toBe(1);
    expect(mocks.tx.courseSession.update).not.toHaveBeenCalled();
  });

  it("J: aplicar el calendario nunca llama a fetch -- WordPress no se toca", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.tx.courseSession.findMany.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await POST(postRequest({
      confirm: "APPLY_WORDPRESS_SCHEDULE",
      calendarRevision: calendarRevisionOf([]),
      sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }],
    }), params());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exige el rol autorizado antes de tocar cualquier dato", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response(null, { status: 403 }) });
    const response = await POST(postRequest({ confirm: "APPLY_WORDPRESS_SCHEDULE", calendarRevision: "x", sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }] }), params());
    expect(response.status).toBe(403);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
  });
});
