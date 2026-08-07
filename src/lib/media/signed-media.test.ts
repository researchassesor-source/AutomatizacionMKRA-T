import { describe, expect, it } from "vitest";
import {
  buildSignedMediaUrl,
  createSignedMediaToken,
  isAllowedMediaSource,
  mediaContentType,
  verifySignedMediaToken,
} from "./signed-media";

const SECRET = "secreto-de-firma-para-medios-suficientemente-largo";
const NOW = 1_800_000_000_000;

describe("firma de enlaces de medios", () => {
  it("acepta un enlace íntegro y vigente", () => {
    const token = createSignedMediaToken("post-1", SECRET, 3600, NOW);
    expect(verifySignedMediaToken("post-1", token, SECRET, NOW + 1000)).toMatchObject({ ok: true });
  });

  it("rechaza el enlace caducado", () => {
    const token = createSignedMediaToken("post-1", SECRET, 60, NOW);
    expect(verifySignedMediaToken("post-1", token, SECRET, NOW + 61_000)).toMatchObject({ ok: false, reason: "EXPIRED" });
  });

  it("rechaza una firma de otro identificador", () => {
    // Sin esto, una firma válida serviría para descargar cualquier vídeo.
    const token = createSignedMediaToken("post-1", SECRET, 3600, NOW);
    expect(verifySignedMediaToken("post-2", token, SECRET, NOW)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("rechaza una caducidad manipulada", () => {
    // La firma cubre id + expiración: alargar la caducidad invalida la firma.
    const token = createSignedMediaToken("post-1", SECRET, 60, NOW);
    const [, signature] = token.split(".");
    const extended = `${Math.floor(NOW / 1000) + 999_999}.${signature}`;
    expect(verifySignedMediaToken("post-1", extended, SECRET, NOW)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("rechaza token ausente, vacío o malformado", () => {
    for (const value of [null, undefined, "", "basura", "sinfirma."]) {
      expect(verifySignedMediaToken("post-1", value, SECRET, NOW).ok).toBe(false);
    }
  });

  it("rechaza una firma de otro secreto", () => {
    const token = createSignedMediaToken("post-1", "otro-secreto-distinto", 3600, NOW);
    expect(verifySignedMediaToken("post-1", token, SECRET, NOW)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("construye una URL con el identificador escapado", () => {
    const url = new URL(buildSignedMediaUrl("https://crm.example.test", "post-1", SECRET));
    expect(url.pathname).toBe("/api/media/tiktok/post-1");
    expect(url.searchParams.get("token")).toBeTruthy();
  });
});

describe("protección contra SSRF y proxy abierto", () => {
  it("solo admite el almacenamiento propio", () => {
    expect(isAllowedMediaSource("https://abc123.public.blob.vercel-storage.com/v.mp4")).toBe(true);
    expect(isAllowedMediaSource("https://blob.vercel-storage.com/v.mp4")).toBe(true);
  });

  it("rechaza destinos internos y ajenos", () => {
    for (const url of [
      "http://localhost/v.mp4",
      "https://localhost/v.mp4",
      "https://127.0.0.1/v.mp4",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/interno.mp4",
      "https://atacante.example/v.mp4",
      "file:///etc/passwd",
      "https://evil.com/?x=.public.blob.vercel-storage.com",
    ]) {
      expect(isAllowedMediaSource(url), url).toBe(false);
    }
  });

  it("no se deja engañar por un subdominio parecido", () => {
    expect(isAllowedMediaSource("https://public.blob.vercel-storage.com.atacante.example/v.mp4")).toBe(false);
  });

  it("exige https", () => {
    expect(isAllowedMediaSource("http://abc.public.blob.vercel-storage.com/v.mp4")).toBe(false);
  });
});

describe("tipo de contenido", () => {
  it("se deriva de la extensión, no de lo que declare el origen", () => {
    expect(mediaContentType("https://x.public.blob.vercel-storage.com/a.mp4")).toBe("video/mp4");
    expect(mediaContentType("https://x.public.blob.vercel-storage.com/a.mov")).toBe("video/quicktime");
    expect(mediaContentType("https://x.public.blob.vercel-storage.com/a.webm")).toBe("video/webm");
  });

  it("rechaza formatos no admitidos", () => {
    expect(mediaContentType("https://x.public.blob.vercel-storage.com/a.exe")).toBeNull();
    expect(mediaContentType("https://x.public.blob.vercel-storage.com/a.html")).toBeNull();
    expect(mediaContentType("https://x.public.blob.vercel-storage.com/sinextension")).toBeNull();
  });
});
