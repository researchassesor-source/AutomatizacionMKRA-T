// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaProxyErrorCode, MediaProxyResult } from "@/lib/whatsapp/media-proxy";

const mocks = vi.hoisted(() => ({
  prisma: {
    inboundMessage: { findUnique: vi.fn() },
  },
  requireRole: vi.fn(async (): Promise<{ session: { userId: string; email: string; role: string } | null; error: Response | null }> => ({
    session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" },
    error: null,
  })),
  descargarMediaDeWhatsApp: vi.fn(async (_mediaId: string): Promise<MediaProxyResult> => ({
    ok: true as const,
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }),
    contentType: "image/jpeg",
    contentLength: 3,
  })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/whatsapp/media-proxy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whatsapp/media-proxy")>("@/lib/whatsapp/media-proxy");
  return { ...actual, descargarMediaDeWhatsApp: mocks.descargarMediaDeWhatsApp };
});

import { GET } from "./route";

function get(id: string, query = "") {
  return GET(new Request(`https://crm.example.test/api/admin/whatsapp/media/${id}${query}`), { params: Promise.resolve({ id }) });
}

function mensaje(overrides: Partial<{ type: string; mediaMeta: Record<string, unknown> | null }> = {}) {
  return {
    type: overrides.type ?? "image",
    mediaMeta: overrides.mediaMeta === undefined ? { id: "meta-media-1", mime_type: "image/jpeg", sha256: "abc" } : overrides.mediaMeta,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.inboundMessage.findUnique.mockResolvedValue(mensaje());
  mocks.descargarMediaDeWhatsApp.mockResolvedValue({
    ok: true,
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }),
    contentType: "image/jpeg",
    contentLength: 3,
  });
});

describe("GET /api/admin/whatsapp/media/[id]: autenticación y resolución del mensaje", () => {
  it("exige el mismo OPERACION que el resto del Inbox", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await get("in-1");
    expect(res.status).toBe(401);
    expect(mocks.prisma.inboundMessage.findUnique).not.toHaveBeenCalled();
  });

  it("404 si el mensaje no existe", async () => {
    mocks.prisma.inboundMessage.findUnique.mockResolvedValue(null);
    const res = await get("in-fantasma");
    expect(res.status).toBe(404);
    expect(mocks.descargarMediaDeWhatsApp).not.toHaveBeenCalled();
  });

  it("422 si el mensaje no es de un tipo multimedia (por ejemplo, texto)", async () => {
    mocks.prisma.inboundMessage.findUnique.mockResolvedValue(mensaje({ type: "text", mediaMeta: null }));
    const res = await get("in-1");
    expect(res.status).toBe(422);
    expect(mocks.descargarMediaDeWhatsApp).not.toHaveBeenCalled();
  });

  it("422 si el tipo es multimedia pero mediaMeta no trae id (payload desconocido de Meta)", async () => {
    mocks.prisma.inboundMessage.findUnique.mockResolvedValue(mensaje({ type: "image", mediaMeta: { unsupportedType: "algo_nuevo" } }));
    const res = await get("in-1");
    expect(res.status).toBe(422);
    expect(mocks.descargarMediaDeWhatsApp).not.toHaveBeenCalled();
  });

  it("422 si mediaMeta es null", async () => {
    mocks.prisma.inboundMessage.findUnique.mockResolvedValue(mensaje({ type: "audio", mediaMeta: null }));
    const res = await get("in-1");
    expect(res.status).toBe(422);
  });

  it("resuelve el media_id de Meta en el servidor a partir de InboundMessage.id: el cliente nunca lo pasa", async () => {
    mocks.prisma.inboundMessage.findUnique.mockResolvedValue(mensaje({ type: "image", mediaMeta: { id: "media-real-de-meta", mime_type: "image/jpeg" } }));
    // El cliente intenta inyectar OTRO media_id por query string; debe ignorarse por completo.
    await get("in-1", "?mediaId=media-inventado-por-el-cliente");
    expect(mocks.descargarMediaDeWhatsApp).toHaveBeenCalledWith("media-real-de-meta");
    expect(mocks.descargarMediaDeWhatsApp).not.toHaveBeenCalledWith("media-inventado-por-el-cliente");
  });

  it("busca por el id propio de InboundMessage, no por ningún id de Meta", async () => {
    await get("in-1");
    expect(mocks.prisma.inboundMessage.findUnique).toHaveBeenCalledWith({ where: { id: "in-1" }, select: { type: true, mediaMeta: true } });
  });
});

describe("GET /api/admin/whatsapp/media/[id]: respuesta exitosa", () => {
  it("devuelve 200 con el Content-Type que reporta el proxy y el cuerpo streameado", async () => {
    const res = await get("in-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Length")).toBe("3");
    const buf = await res.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("agrega X-Content-Type-Options: nosniff y Cache-Control privado", async () => {
    const res = await get("in-1");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("image/audio/video/sticker van inline; document va attachment", async () => {
    const casos: Array<[string, string]> = [["image", "inline"], ["audio", "inline"], ["video", "inline"], ["sticker", "inline"], ["document", "attachment"]];
    for (const [tipo, disposicion] of casos) {
      mocks.prisma.inboundMessage.findUnique.mockResolvedValue(mensaje({ type: tipo, mediaMeta: { id: "m1", mime_type: "x" } }));
      const res = await get("in-1");
      expect(res.headers.get("Content-Disposition")).toContain(`${disposicion}; filename=`);
    }
  });

  it("sanea un filename con separadores de ruta, comillas y saltos de línea (el nombre solo viaja en un header, nunca toca disco: lo único que importa es que no rompa el header)", async () => {
    mocks.prisma.inboundMessage.findUnique.mockResolvedValue(mensaje({ type: "document", mediaMeta: { id: "m1", mime_type: "application/pdf", filename: "../../etc/passwd\"\r\nX-Injected: evil" } }));
    const res = await get("in-1");
    const disposicion = res.headers.get("Content-Disposition") ?? "";
    expect(disposicion).not.toContain("/");
    expect(disposicion).not.toContain("\\");
    expect(disposicion).not.toContain("\r");
    expect(disposicion).not.toContain("\n");
    // Debe seguir habiendo exactamente dos comillas: las que delimitan filename="...".
    expect(disposicion.split('"')).toHaveLength(3);
  });

  it("usa un nombre de respaldo cuando Meta no manda filename", async () => {
    mocks.prisma.inboundMessage.findUnique.mockResolvedValue(mensaje({ type: "image", mediaMeta: { id: "m1", mime_type: "image/jpeg" } }));
    const res = await get("in-1");
    expect(res.headers.get("Content-Disposition")).toContain("whatsapp-image");
  });

  it("sin Content-Length cuando el proxy no lo conoce, no se inventa un valor", async () => {
    mocks.descargarMediaDeWhatsApp.mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      contentType: "video/mp4",
      contentLength: null,
    });
    const res = await get("in-1");
    expect(res.headers.get("Content-Length")).toBeNull();
  });
});

describe("GET /api/admin/whatsapp/media/[id]: errores del proxy se traducen a HTTP", () => {
  const casos: Array<[MediaProxyErrorCode, number]> = [
    ["NOT_CONFIGURED", 503],
    ["TOO_LARGE", 413],
    ["TIMEOUT", 504],
    ["UPSTREAM_ERROR", 502],
    ["UNTRUSTED_HOST", 502],
    ["REDIRECT_BLOCKED", 502],
  ];
  for (const [error, status] of casos) {
    it(`${error} del proxy responde ${status}`, async () => {
      mocks.descargarMediaDeWhatsApp.mockResolvedValue({ ok: false, error });
      const res = await get("in-1");
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.errorCode).toBe(error);
    });
  }
});
