import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFinanceInscripcionPayload, createInscripcion, financeEnrollmentUrl } from "./client";

const input = {
  crmEnrollmentId: "enrollment-1",
  crmContactId: "contact-1",
  crmCourseId: "course-1",
  financeServiceId: null as string | null,
  courseTitle: "IA para Apoyo en Tareas Académicas",
  courseSlug: "ia-apoyo-tareas-estudiantiles",
  modality: "Virtual en vivo",
  startDate: "2026-08-11T00:30:00.000Z",
  endDate: "2026-08-14T02:00:00.000Z",
  timezone: "America/Guayaquil",
  participant: {
    firstName: "Ana",
    lastName: "Pérez",
    fullName: "Ana Pérez",
    email: "ana@example.test",
    phone: "+593999999999",
    identification: null,
  },
  amount: null,
};

afterEach(() => {
  delete process.env.FINANCE_ENROLLMENT_URL_TEMPLATE;
  delete process.env.FINANCE_APP_URL;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("contrato CRM a Finance", () => {
  it("incluye identidad estable, datos reales y ningún dato de pago inventado", () => {
    const payload = buildFinanceInscripcionPayload(input);
    expect(payload).toMatchObject({
      crmEnrollmentId: "enrollment-1",
      crmContactId: "contact-1",
      crmCourseId: "course-1",
      modality: "Virtual en vivo",
      participant: { identification: null },
      amount: null,
    });
    expect(payload.notas).toContain("enrollment-1");
    expect(payload).not.toHaveProperty("paymentMethod");
    expect(payload).not.toHaveProperty("paymentConfirmed");
    expect(payload).not.toHaveProperty("receipt");
  });

  it("sin financeServiceId (curso no vinculado), el payload no envía el campo: Finance cae al nombre", () => {
    const payload = buildFinanceInscripcionPayload(input);
    expect(payload.financeServiceId).toBeUndefined();
    expect(payload.servicioNombre).toBe(input.courseTitle);
  });

  it("con financeServiceId (curso vinculado), el payload lo incluye tal cual", () => {
    const payload = buildFinanceInscripcionPayload({ ...input, financeServiceId: "svc-123" });
    expect(payload.financeServiceId).toBe("svc-123");
  });

  it("centraliza el enlace administrativo sin confundirlo con verificación", () => {
    process.env.FINANCE_APP_URL = "https://finance.example.test/";
    expect(financeEnrollmentUrl("finance-1")).toBe("https://finance.example.test/inscripciones?open=finance-1");
    process.env.FINANCE_ENROLLMENT_URL_TEMPLATE = "https://finance.example.test/inscripciones?open={id}";
    expect(financeEnrollmentUrl("finance/1")).toBe("https://finance.example.test/inscripciones?open=finance%2F1");
  });

  it("envía el Enrollment seleccionado también como clave idempotente y acepta el ID de Finance", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FINANCE_MODE", "live");
    vi.stubEnv("FINANCE_API_URL", "https://finance-api.example.test/exec");
    vi.stubEnv("FINANCE_USER", "integration-user");
    vi.stubEnv("FINANCE_PASS", "integration-pass");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, token: "test-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, id: "FIN-TEST-001" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createInscripcion({ ...input, amount: 75.5 })).resolves.toEqual({ id: "FIN-TEST-001" });
    const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(request).toMatchObject({
      action: "addInscripcion",
      token: "test-token",
      idempotencyKey: "enrollment-1",
      inscripcion: { crmEnrollmentId: "enrollment-1", participant: { identification: null }, amount: 75.5 },
    });
    expect(request).not.toHaveProperty("payload");
  });
});

/**
 * Hallazgo de producción: createInscripcion destruía response.error y siempre
 * lanzaba el mismo mensaje genérico. El CRM nunca podía distinguir "este curso
 * no tiene servicio en Finance" de un fallo transitorio.
 *
 * Cada prueba resetea el módulo: `cachedToken` es estado de módulo con 20h de
 * TTL y, sin esto, un login exitoso de una prueba anterior lo dejaría en caché
 * y la secuencia de fetch mockeada aquí (login + addInscripcion) no calzaría.
 */
describe("mapeo seguro de errores de Finance", () => {
  async function freshClientWithFetch(fetchMock: ReturnType<typeof vi.fn>) {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FINANCE_MODE", "live");
    vi.stubEnv("FINANCE_API_URL", "https://finance-api.example.test/exec");
    vi.stubEnv("FINANCE_USER", "integration-user");
    vi.stubEnv("FINANCE_PASS", "integration-pass");
    vi.stubGlobal("fetch", fetchMock);
    return import("./client");
  }

  it("'Servicio de Finance no configurado para este curso.' => FINANCE_SERVICE_NOT_CONFIGURED", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, token: "test-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: "Servicio de Finance no configurado para este curso." }), { status: 200 }));
    const fresh = await freshClientWithFetch(fetchMock);
    await expect(fresh.createInscripcion(input)).rejects.toThrow("FINANCE_SERVICE_NOT_CONFIGURED");
  });

  it("'Finance rechazó la autenticación.' => FINANCE_AUTH_FAILED", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, token: "test-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: "Finance rechazó la autenticación." }), { status: 200 }));
    const fresh = await freshClientWithFetch(fetchMock);
    await expect(fresh.createInscripcion(input)).rejects.toThrow("FINANCE_AUTH_FAILED");
  });

  it("un fallo de login también se clasifica, no solo el de addInscripcion", async () => {
    // getServiceToken lanza antes de llegar a addInscripcion: un solo fetch.
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ success: false }), { status: 200 }));
    const fresh = await freshClientWithFetch(fetchMock);
    await expect(fresh.createInscripcion(input)).rejects.toThrow("FINANCE_AUTH_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un error desconocido de Finance cae en FINANCE_REQUEST_FAILED sin filtrar nada", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, token: "test-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        error: "token=sk_live_secreto123 en https://finance-internal.example.test/exec falló con stack Error: at line 42",
      }), { status: 200 }));
    const fresh = await freshClientWithFetch(fetchMock);
    let caught: unknown;
    try {
      await fresh.createInscripcion(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toBe("FINANCE_REQUEST_FAILED");
    expect(message).not.toMatch(/secreto|token=|https:|stack|Error: at/i);
  });

  it("el envío exitoso y la idempotencia no cambian", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, token: "test-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, id: "FIN-TEST-002" }), { status: 200 }));
    const fresh = await freshClientWithFetch(fetchMock);
    await expect(fresh.createInscripcion(input)).resolves.toEqual({ id: "FIN-TEST-002" });
    const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(request.idempotencyKey).toBe("enrollment-1");
  });
});
