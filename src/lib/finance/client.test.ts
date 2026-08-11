import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFinanceInscripcionPayload, createInscripcion, financeEnrollmentUrl } from "./client";

const input = {
  crmEnrollmentId: "enrollment-1",
  crmContactId: "contact-1",
  crmCourseId: "course-1",
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
    expect(request.payload).toMatchObject({
      action: "addInscripcion",
      token: "test-token",
      idempotencyKey: "enrollment-1",
      inscripcion: { crmEnrollmentId: "enrollment-1", participant: { identification: null }, amount: 75.5 },
    });
  });
});
