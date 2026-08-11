import { afterEach, describe, expect, it } from "vitest";
import { buildFinanceInscripcionPayload, financeEnrollmentUrl } from "./client";

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
    expect(financeEnrollmentUrl("finance-1")).toBe("https://finance.example.test");
    process.env.FINANCE_ENROLLMENT_URL_TEMPLATE = "https://finance.example.test/inscripciones/{id}";
    expect(financeEnrollmentUrl("finance/1")).toBe("https://finance.example.test/inscripciones/finance%2F1");
  });
});
