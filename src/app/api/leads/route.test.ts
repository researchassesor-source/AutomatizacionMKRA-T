import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureLead: vi.fn(),
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/leads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leads")>();
  return { ...actual, captureLead: mocks.captureLead };
});
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  requestKey: () => "lead-capture:test",
}));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { OPTIONS, POST } from "./route";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Persona",
    lastName: "Ficticia",
    email: "persona@example.test",
    phone: "0982716252",
    courseSlug: "curso-prueba",
    consent: true,
    website: "",
    formStartedAt: Date.now() - 3000,
    idempotencyKey: "route_test_12345",
    ...overrides,
  };
}

function request(body: BodyInit | null, options: { origin?: string; contentType?: string; length?: string } = {}) {
  const headers = new Headers();
  if (options.origin) headers.set("origin", options.origin);
  if (options.contentType !== null) headers.set("content-type", options.contentType ?? "application/json");
  if (options.length) headers.set("content-length", options.length);
  return new Request("https://preview-feature.example.test/api/leads", {
    method: "POST",
    headers,
    body,
  });
}

afterEach(() => {
  mocks.captureLead.mockReset();
  mocks.checkRateLimit.mockReset();
  mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.writeAudit.mockClear();
});

describe("POST /api/leads", () => {
  it("responde preflight solo a origen permitido", async () => {
    const allowed = await OPTIONS(request(null, { origin: "https://ra-training.com" }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://ra-training.com");

    const rejected = await OPTIONS(request(null, { origin: "https://evil.example.test" }));
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rechaza CORS externo antes de procesar datos", async () => {
    const response = await POST(request(JSON.stringify(validBody()), { origin: "https://evil.example.test" }));
    expect(response.status).toBe(403);
    expect(mocks.captureLead).not.toHaveBeenCalled();
  });

  it("rechaza Content-Type incorrecto", async () => {
    const response = await POST(request(JSON.stringify(validBody()), { contentType: "text/plain" }));
    expect(response.status).toBe(415);
  });

  it("rechaza payload demasiado grande", async () => {
    const response = await POST(request(JSON.stringify(validBody()), { length: "20000" }));
    expect(response.status).toBe(413);
  });

  it("rechaza JSON invalido", async () => {
    const response = await POST(request("{"));
    expect(response.status).toBe(400);
  });

  it("bloquea honeypot y envio demasiado rapido", async () => {
    const spam = await POST(request(JSON.stringify(validBody({ website: "bot" }))));
    expect(spam.status).toBe(422);
    expect(await spam.json()).toMatchObject({ error: expect.not.stringContaining("honeypot") });

    const fast = await POST(request(JSON.stringify(validBody({ formStartedAt: Date.now() - 100 }))));
    expect(fast.status).toBe(422);
    expect(mocks.captureLead).not.toHaveBeenCalled();
  });

  it("aplica rate limit con Retry-After", async () => {
    mocks.checkRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 120 });
    const response = await POST(request(JSON.stringify(validBody())));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
  });

  it("distingue curso inexistente y curso no disponible", async () => {
    mocks.captureLead.mockRejectedValueOnce(new Error("COURSE_NOT_FOUND"));
    expect((await POST(request(JSON.stringify(validBody())))).status).toBe(404);
    mocks.captureLead.mockRejectedValueOnce(new Error("COURSE_UNAVAILABLE"));
    expect((await POST(request(JSON.stringify(validBody())))).status).toBe(422);
  });

  it("transforma conflictos y errores Prisma sin exponer detalles", async () => {
    mocks.captureLead.mockRejectedValueOnce(new Error("CONTACT_IDENTITY_CONFLICT"));
    expect((await POST(request(JSON.stringify(validBody())))).status).toBe(409);
    mocks.captureLead.mockRejectedValueOnce(new Error("postgresql://secret-host/customer-password"));
    const response = await POST(request(JSON.stringify(validBody())));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
  });

  it("devuelve alta segura con request ID e idempotencia delegada", async () => {
    mocks.captureLead.mockResolvedValue({
      lead: { id: "lead-test" },
      enrollment: { id: "enrollment-test" },
      redirectUrl: "/gracias?curso=curso-prueba",
      created: true,
      enrollmentCreated: true,
      duplicate: false,
      message: "ok",
    });
    const response = await POST(request(JSON.stringify(validBody()), { origin: "https://ra-training.com" }));
    expect(response.status).toBe(201);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(await response.json()).toMatchObject({
      ok: true,
      leadId: "lead-test",
      enrollmentId: "enrollment-test",
      redirectUrl: "/gracias?curso=curso-prueba",
    });
    expect(mocks.captureLead).toHaveBeenCalledOnce();
  });
});
