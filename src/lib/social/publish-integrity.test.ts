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

  it("continúa un video aceptado usando el mismo identificador del proveedor", async () => {
    liveEnv();
    mocks.prisma.socialPost.findUnique
      .mockResolvedValueOnce({ scheduledAt: post().scheduledAt, status: "ACEPTADO", providerStatus: "PROCESSING", externalPostId: "container-1" })
      .mockResolvedValueOnce(post({
        status: "ACEPTADO",
        externalPostId: "container-1",
        providerStatus: "PROCESSING",
        providerResponse: { mediaType: "VIDEO", containerId: "container-1" },
        account: { platform: "INSTAGRAM", isActive: true, displayName: "Instagram" },
      }));
    mocks.publish.mockResolvedValue({ ok: true, accepted: true, externalPostId: "container-1", providerStatus: "PROCESSING" });

    const result = await publishPost("post-1");

    expect(result).toMatchObject({ ok: true, accepted: true, externalPostId: "container-1" });
    expect(mocks.prisma.socialPost.updateMany.mock.calls[0][0].where).toMatchObject({ status: "ACEPTADO", externalPostId: "container-1", providerStatus: "PROCESSING" });
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ mediaType: "VIDEO", externalPostId: "container-1", providerStatus: "PROCESSING" }));
    expect(mocks.prisma.socialPost.update.mock.calls[0][0].data.status).toBe("ACEPTADO");
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

  it("crea un Reel y queda procesando sin bloquear ni crear un segundo container", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "ig-container-1" }), { status: 200 }),
    );
    const adapter = new MetaAdapter("INSTAGRAM", { accessToken: "t", igUserId: "1784", graphVersion: "v25.0" });
    const result = await adapter.publish({ caption: "Video", mediaUrl: "https://blob.example.com/reel.mp4", mediaType: "VIDEO" });
    expect(result).toMatchObject({ ok: true, accepted: true, externalPostId: "ig-container-1", providerStatus: "PROCESSING" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain("media_type=REELS");
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain("video_url=");
    fetchSpy.mockRestore();
  });

  it("reanuda el mismo container de Instagram mientras sigue procesando", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 }),
    );
    const adapter = new MetaAdapter("INSTAGRAM", { accessToken: "t", igUserId: "1784", graphVersion: "v25.0" });
    const result = await adapter.publish({
      caption: "Video",
      mediaUrl: "https://blob.example.com/reel.mp4",
      mediaType: "VIDEO",
      externalPostId: "ig-container-1",
      providerStatus: "PROCESSING",
    });
    expect(result).toMatchObject({ ok: true, accepted: true, externalPostId: "ig-container-1" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("ig-container-1?fields=status_code,status");
    expect(fetchSpy.mock.calls[0][1]?.method).toBeUndefined();
    fetchSpy.mockRestore();
  });

  /**
   * Graph simulada con una respuesta NUEVA por llamada.
   *
   * `mockResolvedValue` devuelve siempre el mismo objeto `Response`, y el
   * cuerpo de una Response solo puede leerse una vez. Desde que Facebook pide
   * la credencial de pagina antes de publicar hay dos llamadas, y la segunda
   * recibia un cuerpo ya consumido.
   */
  function graphSimulada() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("fields=access_token")
        ? new Response(JSON.stringify({ id: "1190", access_token: "token-de-pagina" }), { status: 200 })
        : new Response(JSON.stringify({ id: "1190_777" }), { status: 200 }),
    );
  }

  it("Facebook sí admite publicación de solo texto", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = graphSimulada();
    const adapter = new MetaAdapter("FACEBOOK", { accessToken: "t", pageId: "1190", graphVersion: "v25.0" });
    const result = await adapter.publish({ caption: "Solo texto" });
    expect(result).toMatchObject({ ok: true, externalPostId: "1190_777" });
    fetchSpy.mockRestore();
  });

  it("Facebook conserva fotos y selecciona /videos solo para video", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("fields=access_token")) return new Response(JSON.stringify({ access_token: "token-de-pagina" }), { status: 200 });
      return new Response(JSON.stringify({ id: url.includes("/videos") ? "video-1" : "photo-1", post_id: url.includes("/photos") ? "post-photo-1" : undefined }), { status: 200 });
    });
    const adapter = new MetaAdapter("FACEBOOK", { accessToken: "t", pageId: "1190", graphVersion: "v25.0" });

    const image = await adapter.publish({ caption: "Imagen", mediaUrl: "https://blob.example.com/foto.jpg", mediaType: "IMAGE" });
    expect(image).toMatchObject({ ok: true, externalPostId: "post-photo-1" });
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/1190/photos"))).toBe(true);

    fetchSpy.mockClear();
    const video = await adapter.publish({ caption: "Video", mediaUrl: "https://blob.example.com/reel.mp4", mediaType: "VIDEO" });
    expect(video).toMatchObject({ ok: true, accepted: true, externalPostId: "video-1", providerStatus: "PROCESSING" });
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/1190/videos"))).toBe(true);
    fetchSpy.mockRestore();
  });

  it("el token viaja en la cabecera, nunca en la URL", async () => {
    const { MetaAdapter } = await vi.importActual<typeof import("./adapters/meta")>("./adapters/meta");
    const fetchSpy = graphSimulada();
    const adapter = new MetaAdapter("FACEBOOK", { accessToken: "token-secreto", pageId: "1190", graphVersion: "v25.0" });
    await adapter.publish({ caption: "Hola" });
    // Se comprueban TODAS las llamadas: la del token de pagina va con el del
    // sistema, y la publicacion con el de pagina. Ninguna puede llevarlo en la
    // URL ni en el cuerpo.
    for (const [url, init] of fetchSpy.mock.calls) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(String(url)).not.toContain("token-secreto");
      expect(String(url)).not.toContain("token-de-pagina");
      expect(String(init?.body ?? "")).not.toContain("token-secreto");
      expect(String(init?.body ?? "")).not.toContain("token-de-pagina");
      expect(headers.Authorization).toMatch(/^Bearer (token-secreto|token-de-pagina)$/);
    }
    fetchSpy.mockRestore();
  });
});
