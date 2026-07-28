import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMessagingSimulation, renderMessageTemplate } from "./nurture/engine";
import { isFinanceSimulation } from "./finance/client";
import { nextGuayaquilOccurrence } from "./social/orchestrator";
import { POST as legacyComplete } from "@/app/api/courses/complete/route";
import { moodleCompletionSchema } from "./moodle";

afterEach(() => vi.unstubAllEnvs());

describe("integraciones seguras", () => {
  it("renderiza la URL específica del curso", () => {
    expect(renderMessageTemplate("Hola {{nombre}}: {{courseUrl}}", { nombre: "Ana", courseUrl: "https://ra-training.com/cursos/curso/" })).toContain("https://ra-training.com/cursos/curso/");
  });
  it("no reemplaza variables desconocidas", () => expect(renderMessageTemplate("{{secret}}", {})).toBe("{{secret}}"));
  it("Finance siempre simula en local", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FINANCE_MODE", "live");
    expect(isFinanceSimulation()).toBe(true);
  });
  it("el cliente Finance no contiene una ruta de emisión", () => {
    const source = readFileSync(new URL("./finance/client.ts", import.meta.url), "utf8");
    expect(source).not.toContain("emitCertificate");
    expect(source).not.toContain("updateInscripcion");
    expect(source).not.toContain("?payload=");
    expect(source).toContain('method: "POST"');
  });
  it("mensajería siempre simula en local aunque existan credenciales", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MESSAGING_MODE", "live");
    expect(isMessagingSimulation()).toBe(true);
  });
  it("mensajería requiere activación explícita en Producción", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MESSAGING_MODE", "simulation");
    expect(isMessagingSimulation()).toBe(true);
    vi.stubEnv("MESSAGING_MODE", "live");
    expect(isMessagingSimulation()).toBe(false);
  });
  it("la finalización pública antigua está deshabilitada", async () => expect((await legacyComplete()).status).toBe(410));
  it("calcula la siguiente recurrencia en America/Guayaquil", () => {
    const next = nextGuayaquilOccurrence(1, "09:30", new Date("2026-07-27T15:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-08-03T14:30:00.000Z");
  });
  it("el modelo separa una inscripción por contacto y curso", () => {
    const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    expect(schema).toContain("@@unique([leadId, courseId])");
    expect(schema).toContain("financeInscripcionId     String?           @unique");
  });
  it("Moodle exige la identidad única de la inscripción", () => {
    const base = {
      eventId: "evento-ficticio-123",
      email: "persona@example.test",
      courseSlug: "curso-ficticio",
    };
    expect(moodleCompletionSchema.safeParse(base).success).toBe(false);
    expect(moodleCompletionSchema.safeParse({ ...base, enrollmentId: "enrollment-ficticio" }).success).toBe(true);
  });
  it("el esquema protege las claves idempotentes relevantes", () => {
    const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    expect(schema).toContain("idempotencyKey String?     @unique");
    expect(schema).toContain("occurrenceKey    String?         @unique");
    expect(schema).toContain("@@unique([leadId, enrollmentId, sequenceKey, stepKey])");
  });
});
