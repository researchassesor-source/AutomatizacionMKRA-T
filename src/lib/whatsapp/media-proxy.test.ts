import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_MAX_BYTES, descargarMediaDeWhatsApp } from "./media-proxy";

const CREDENTIALS = {
  WHATSAPP_PHONE_NUMBER_ID: "111",
  WHATSAPP_ACCESS_TOKEN: "token-de-prueba-super-secreto",
  WHATSAPP_GRAPH_API_VERSION: "25.0",
};

function stubCredentials() {
  for (const [key, val] of Object.entries(CREDENTIALS)) vi.stubEnv(key, val);
}

function metadataResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function downloadResponse(bytes: Uint8Array, opts: { status?: number; contentType?: string; contentLength?: string | null; location?: string } = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const headers = new Headers();
  if (opts.contentType) headers.set("content-type", opts.contentType);
  if (opts.contentLength !== undefined && opts.contentLength !== null) headers.set("content-length", opts.contentLength);
  else if (opts.contentLength === undefined) headers.set("content-length", String(bytes.byteLength));
  if (opts.location) headers.set("location", opts.location);
  return new Response(opts.status && opts.status >= 300 && opts.status < 400 ? null : stream, { status: opts.status ?? 200, headers });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<{ bytes: number; error?: unknown }> {
  const reader = stream.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
    return { bytes };
  } catch (error) {
    return { bytes, error };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("descargarMediaDeWhatsApp", () => {
  it("falla cerrado (NOT_CONFIGURED) si faltan credenciales, sin llamar a Meta", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await descargarMediaDeWhatsApp("media-1");
    expect(result).toMatchObject({ ok: false, error: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hace los dos saltos documentados por Meta: metadata autenticada, luego la URL temporal, también autenticada", async () => {
    stubCredentials();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metadataResponse({ url: "https://lookaside.fbsbx.com/tmp/abc", mime_type: "image/jpeg", file_size: 4 }))
      .mockResolvedValueOnce(downloadResponse(bytes, { contentType: "image/jpeg" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await descargarMediaDeWhatsApp("media-1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("esperaba éxito");
    expect(result.contentType).toBe("image/jpeg");
    expect(result.contentLength).toBe(4);
    expect(await drain(result.body)).toMatchObject({ bytes: 4 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [metaUrl, metaInit] = fetchMock.mock.calls[0];
    expect(metaUrl).toBe("https://graph.facebook.com/v25.0/media-1");
    const metaHeaders = metaInit?.headers as Record<string, string> | undefined;
    expect(metaHeaders?.Authorization).toBe("Bearer token-de-prueba-super-secreto");
    const [downloadUrl, downloadInit] = fetchMock.mock.calls[1];
    expect(downloadUrl).toBe("https://lookaside.fbsbx.com/tmp/abc");
    const downloadHeaders = downloadInit?.headers as Record<string, string> | undefined;
    expect(downloadHeaders?.Authorization).toBe("Bearer token-de-prueba-super-secreto");
    expect(downloadInit?.redirect).toBe("manual");
  });

  it("usa la versión de Graph configurada, no un valor fijo", async () => {
    stubCredentials();
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "23.0");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metadataResponse({ url: "https://lookaside.fbsbx.com/tmp/abc", mime_type: "image/jpeg" }))
      .mockResolvedValueOnce(downloadResponse(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetchMock);
    await descargarMediaDeWhatsApp("media-1");
    expect(fetchMock.mock.calls[0][0]).toContain("/v23.0/");
  });

  it("rechaza (UNTRUSTED_HOST) una URL de descarga fuera del allowlist de Meta, y nunca hace el segundo fetch", async () => {
    stubCredentials();
    const fetchMock = vi.fn().mockResolvedValueOnce(metadataResponse({ url: "https://evil.example.com/steal", mime_type: "image/jpeg" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await descargarMediaDeWhatsApp("media-1");
    expect(result).toMatchObject({ ok: false, error: "UNTRUSTED_HOST" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rechaza un host que solo imita el sufijo real (fbsbx.com.evil.com) o que carece del punto separador", async () => {
    stubCredentials();
    for (const url of ["https://fbsbx.com.evil.com/x", "https://evilfbsbx.com/x", "http://lookaside.fbsbx.com/tmp/abc"]) {
      const fetchMock = vi.fn().mockResolvedValueOnce(metadataResponse({ url, mime_type: "image/jpeg" }));
      vi.stubGlobal("fetch", fetchMock);
      const result = await descargarMediaDeWhatsApp("media-1");
      expect(result).toMatchObject({ ok: false, error: "UNTRUSTED_HOST" });
    }
  });

  it("rechaza (REDIRECT_BLOCKED) si la URL temporal responde con una redirección en vez del archivo", async () => {
    stubCredentials();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metadataResponse({ url: "https://lookaside.fbsbx.com/tmp/abc", mime_type: "image/jpeg" }))
      .mockResolvedValueOnce(downloadResponse(new Uint8Array(), { status: 302, location: "https://evil.example.com/steal" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await descargarMediaDeWhatsApp("media-1");
    expect(result).toMatchObject({ ok: false, error: "REDIRECT_BLOCKED" });
  });

  it("rechaza (TOO_LARGE) cuando Meta ya declara un file_size mayor al tope, sin descargar nada", async () => {
    stubCredentials();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      metadataResponse({ url: "https://lookaside.fbsbx.com/tmp/abc", mime_type: "video/mp4", file_size: 999_999_999 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await descargarMediaDeWhatsApp("media-1");
    expect(result).toMatchObject({ ok: false, error: "TOO_LARGE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(999_999_999).toBeGreaterThan(MEDIA_MAX_BYTES);
  });

  it("rechaza (TOO_LARGE) por Content-Length de la descarga aunque Meta no haya declarado file_size", async () => {
    stubCredentials();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metadataResponse({ url: "https://lookaside.fbsbx.com/tmp/abc", mime_type: "video/mp4" }))
      .mockResolvedValueOnce(downloadResponse(new Uint8Array([1]), { contentLength: String(50 * 1024 * 1024) }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await descargarMediaDeWhatsApp("media-1");
    expect(result).toMatchObject({ ok: false, error: "TOO_LARGE" });
  });

  it("corta la descarga en pleno streaming si el total real supera el tope, aunque no viniera Content-Length", async () => {
    stubCredentials();
    const bloqueGrande = new Uint8Array(MEDIA_MAX_BYTES + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bloqueGrande);
        controller.close();
      },
    });
    const headers = new Headers({ "content-type": "application/octet-stream" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metadataResponse({ url: "https://lookaside.fbsbx.com/tmp/abc", mime_type: "application/octet-stream" }))
      .mockResolvedValueOnce(new Response(stream, { status: 200, headers }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await descargarMediaDeWhatsApp("media-1");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("esperaba stream inicial válido");
    const { error } = await drain(result.body);
    expect(error).toBeDefined();
  });

  it("clasifica como UPSTREAM_ERROR una respuesta de metadata que no es 2xx", async () => {
    stubCredentials();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(metadataResponse({ error: { message: "not found" } }, 404)));
    const result = await descargarMediaDeWhatsApp("media-inexistente");
    expect(result).toMatchObject({ ok: false, error: "UPSTREAM_ERROR" });
  });

  it("clasifica como TIMEOUT un fallo de red, sin lanzar una excepción", async () => {
    stubCredentials();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    const result = await descargarMediaDeWhatsApp("media-1");
    expect(result).toMatchObject({ ok: false, error: "TIMEOUT" });
  });

  it("nunca deja el token de acceso en el resultado devuelto", async () => {
    stubCredentials();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metadataResponse({ url: "https://lookaside.fbsbx.com/tmp/abc", mime_type: "image/jpeg" }))
      .mockResolvedValueOnce(downloadResponse(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetchMock);
    const result = await descargarMediaDeWhatsApp("media-1");
    const serializado = JSON.stringify({ ...result, body: undefined });
    expect(serializado).not.toContain(CREDENTIALS.WHATSAPP_ACCESS_TOKEN);
  });
});
