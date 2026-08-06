// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    socialPost: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    socialSchedule: { findMany: vi.fn(), update: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
  publish: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("./adapters/meta", async () => {
  const actual = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
  return {
    ...actual,
    MetaAdapter: class {
      readonly platform: string;
      constructor(platform: string) { this.platform = platform; }
      isConfigured() { return true; }
      publish(input: unknown) { return mocks.publish(input); }
    },
  };
});

import { publishPost } from "./orchestrator";
import { isPublicHttpsUrl } from "./adapters/meta";

function liveEnv() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SOCIAL_MODE", "live");
  vi.stubEnv("SOCIAL_LIVE_FROM", "2026-01-01T00:00:00Z");
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    caption: "Contenido de prueba",
    mediaUrl: "https://blob.example.com/imagen.jpg",
    linkUrl: null,
    scheduledAt: new Date("2026-08-06T12:00:00.000Z"),
    status: "PROGRAMADO",
    account: { platform: "FACEBOOK", isActive: true, displayName: "Research Assessor & Training" },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.prisma.socialPost.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.socialPost.update.mockResolvedValue({});
});

afterEach(() => vi.unstubAllEnvs());

describe("integridad de la publicación", () => {
  it("no marca como publicada una respuesta sin identificador del proveedor", async () => {
    liveEnv();
    mocks.prisma.socialPost.findUnique.mockResolvedValueOnce({ scheduledAt: post().scheduledAt, status: "PROGRAMADO" }).mockResolvedValueOnce(post());
    mocks.publish.mockResolvedValue({ ok: true });
    const result = await publishPost("post-1");
    expect(result).toMatchObject({ ok: false, errorCode: "MISSING_PROVIDER_ID" });
    const saved = mocks.prisma.socialPost.update.mock.calls[0][0].data;
    expect(saved.status).toBe("FALLIDO");
    expect(saved.publishedAt).toBeUndefined();
  });

  it("guarda el identificador externo cuando la publicación es verificable", async () => {
    liveEnv();
    mocks.prisma.socialPost.findUnique.mockResolvedValueOnce({ scheduledAt: post().scheduledAt, status: "PROGRAMADO" }).mockResolvedValueOnce(post());
    mocks.publish.mockResolvedValue({ ok: true, externalPostId: "1190_9988", providerPostUrl: "https://www.facebook.com/1190_9988" });
    const result = await publishPost("post-1");
    expect(result.ok).toBe(true);
    const saved = mocks.prisma.socialPost.update.mock.calls[0][0].data;
    expect(saved.status).toBe("PUBLICADO");
    expect(saved.externalPostId).toBe("1190_9988");
  });

  it("una publicación simulada no recibe identificador falso", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("SOCIAL_MODE", "live");
    mocks.prisma.socialPost.findUnique.mockResolvedValueOnce({ scheduledAt: post().scheduledAt, status: "PROGRAMADO" }).mockResolvedValueOnce(post());
    const result = await publishPost("post-1");
    expect(result).toMatchObject({ ok: true, simulated: true });
    // Preview nunca llama al proveedor.
    expect(mocks.publish).not.toHaveBeenCalled();
    const saved = mocks.prisma.socialPost.update.mock.calls[0][0].data;
    expect(saved.status).toBe("SIMULADO");
    expect(saved.externalPostId).toBeUndefined();
  });

  it("no republica un registro que ya tiene identificador del proveedor", async () => {
    liveEnv();
    mocks.prisma.socialPost.findUnique.mockResolvedValue({ scheduledAt: post().scheduledAt, status: "FALLIDO" });
    mocks.prisma.socialPost.updateMany.mockResolvedValue({ count: 0 });
    const result = await publishPost("post-1");
    expect(result.ok).toBe(false);
    expect(mocks.publish).not.toHaveBeenCalled();
    // La condición externalPostId: null es la barrera contra duplicados.
    expect(mocks.prisma.socialPost.updateMany.mock.calls[0][0].where.externalPostId).toBeNull();
  });

  it("una cuenta inactiva impide reclamar la publicación", async () => {
    liveEnv();
    mocks.prisma.socialPost.findUnique.mockResolvedValue({ scheduledAt: post().scheduledAt, status: "PROGRAMADO" });
    mocks.prisma.socialPost.updateMany.mockResolvedValue({ count: 0 });
    const result = await publishPost("post-1");
    expect(result.ok).toBe(false);
    expect(mocks.prisma.socialPost.updateMany.mock.calls[0][0].where.account).toEqual({ isActive: true });
  });

  it("un error del proveedor deja el registro reintentable con mensaje legible", async () => {
    liveEnv();
    mocks.prisma.socialPost.findUnique.mockResolvedValueOnce({ scheduledAt: post().scheduledAt, status: "PROGRAMADO" }).mockResolvedValueOnce(post());
    mocks.publish.mockResolvedValue({ ok: false, errorCode: "META_200", error: "Meta rechazó la publicación por permisos insuficientes." });
    await publishPost("post-1");
    const saved = mocks.prisma.socialPost.update.mock.calls[0][0].data;
    expect(saved.status).toBe("FALLIDO");
    expect(saved.errorCode).toBe("META_200");
    expect(saved.retryCount).toEqual({ increment: 1 });
  });
});

describe("validación de multimedia antes de llamar a Meta", () => {
  it("exige URL pública HTTPS", () => {
    expect(isPublicHttpsUrl("https://blob.example.com/imagen.jpg")).toBe(true);
    expect(isPublicHttpsUrl("http://blob.example.com/imagen.jpg")).toBe(false);
    expect(isPublicHttpsUrl("https://localhost/imagen.jpg")).toBe(false);
    expect(isPublicHttpsUrl("https://127.0.0.1/imagen.jpg")).toBe(false);
    expect(isPublicHttpsUrl("/ruta/local.jpg")).toBe(false);
  });
});

describe("requisitos reales de Instagram", () => {
  it("Instagram sin multimedia falla con un motivo claro y sin llamar a la API", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = new MetaAdapter("INSTAGRAM", { accessToken: "t", igUserId: "1784", graphVersion: "v25.0" });
    const result = await adapter.publish({ caption: "Solo texto" });
    expect(result).toMatchObject({ ok: false, errorCode: "MEDIA_REQUIRED" });
    expect(result.error).toContain("imagen");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rechaza una URL no pública antes de contactar a Meta", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = new MetaAdapter("INSTAGRAM", { accessToken: "t", igUserId: "1784", graphVersion: "v25.0" });
    const result = await adapter.publish({ caption: "Hola", mediaUrl: "http://localhost:3000/foto.jpg" });
    expect(result).toMatchObject({ ok: false, errorCode: "MEDIA_NOT_PUBLIC" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("Facebook sí admite publicación de solo texto", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1190_777" }), { status: 200 }),
    );
    const adapter = new MetaAdapter("FACEBOOK", { accessToken: "t", pageId: "1190", graphVersion: "v25.0" });
    const result = await adapter.publish({ caption: "Solo texto" });
    expect(result).toMatchObject({ ok: true, externalPostId: "1190_777" });
    fetchSpy.mockRestore();
  });

  it("el token viaja en la cabecera, nunca en la URL", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1190_777" }), { status: 200 }),
    );
    const adapter = new MetaAdapter("FACEBOOK", { accessToken: "token-secreto", pageId: "1190", graphVersion: "v25.0" });
    await adapter.publish({ caption: "Hola" });
    const [url, init] = fetchSpy.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(String(url)).not.toContain("token-secreto");
    expect(headers.Authorization).toContain("token-secreto");
    expect(String(init?.body ?? "")).not.toContain("token-secreto");
    fetchSpy.mockRestore();
  });
});
