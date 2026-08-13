import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El compositor y la ruta de subida tienen que hablar el mismo protocolo.
 *
 * El fallo que motiva estas pruebas: el compositor llamaba a
 * `/api/admin/upload/token` con `{ filename, contentType }` y leia
 * `{ uploadUrl, publicUrl }` de la respuesta. Esa ruta implementa el protocolo
 * de subida directa de Vercel Blob, que espera un cuerpo con
 * `type: "blob.generate-client-token"` y responde con un `clientToken`. Ni el
 * cuerpo ni la respuesta coincidian, asi que la subida devolvia 400 siempre,
 * en cualquier entorno.
 *
 * No lo detecto ninguna prueba porque no habia ninguna: el contrato entre las
 * dos piezas solo existia en la cabeza de quien lo escribio. Estas
 * comprobaciones leen el codigo fuente, que es barato y no necesita navegador,
 * y fallan si alguien vuelve a separarlos.
 */
const raiz = join(process.cwd(), "src");

/**
 * Codigo sin comentarios.
 *
 * Hace falta porque el comentario que documenta este fallo nombra a proposito
 * la ruta y los campos equivocados, para que quien lo lea entienda que paso.
 * Sin quitarlos, estas comprobaciones acusarian al texto que las explica.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const composer = soloCodigo(readFileSync(join(raiz, "app/admin/redes/PublishComposer.tsx"), "utf8"));
const rutaImagen = readFileSync(join(raiz, "app/api/admin/upload/route.ts"), "utf8");
const rutaToken = readFileSync(join(raiz, "app/api/admin/upload/token/route.ts"), "utf8");
const redesManager = readFileSync(join(raiz, "app/admin/redes/RedesManager.tsx"), "utf8");

describe("subida de imagen del compositor", () => {
  it("conserva la ruta multipart de imágenes", () => {
    expect(composer).toContain('fetch("/api/admin/upload"');
  });

  it("envia el archivo como FormData con el campo que la ruta lee", () => {
    expect(composer).toMatch(/new FormData\(\)/);
    expect(composer).toMatch(/append\("file"/);
    expect(rutaImagen).toMatch(/form\.get\("file"\)/);
  });

  it("lee el mismo campo de la respuesta que la ruta devuelve", () => {
    // La ruta responde { url }. Leer otro nombre deja la vista previa vacia
    // aunque la subida haya funcionado.
    expect(rutaImagen).toMatch(/NextResponse\.json\(\{ url: blob\.url \}\)/);
    expect(composer).toMatch(/resultado\.url/);
    expect(composer).not.toMatch(/\b(uploadUrl|publicUrl)\b/);
  });

  it("muestra el motivo que da el servidor cuando falla", () => {
    // Un "inténtalo de nuevo" a secas ante una imagen de 8 MB hace que quien
    // sube repita el mismo archivo indefinidamente.
    expect(composer).toMatch(/detail: resultado\.error/);
  });
});

describe("ruta de imagenes", () => {
  it("acepta cualquier imagen y siempre entrega JPEG", () => {
    // Instagram no admite PNG ni WebP: la conversion no es un lujo.
    expect(rutaImagen).toMatch(/\.jpeg\(/);
    expect(rutaImagen).toMatch(/contentType: "image\/jpeg"/);
    expect(rutaImagen).toMatch(/access: "public"/);
  });

  it("no filtra jerga tecnica en los mensajes de error", () => {
    const mensajes = [...rutaImagen.matchAll(/error: [`"]([^`"]+)[`"]/g)].map((m) => m[1]);
    expect(mensajes.length).toBeGreaterThan(0);
    for (const mensaje of mensajes) {
      expect(mensaje).not.toMatch(/peticion invalida|falta el archivo|^el archivo debe/);
      // Cada mensaje debe empezar en mayuscula: es texto para una persona.
      expect(mensaje[0]).toBe(mensaje[0].toUpperCase());
    }
  });
});

describe("ruta de token", () => {
  it("sigue reservada a video y ahora la utiliza el compositor", () => {
    expect(rutaToken).toContain("SOCIAL_VIDEO_MIME_TYPES");
    expect(rutaToken).not.toContain("image/");
    expect(composer).toContain('handleUploadUrl: "/api/admin/upload/token"');
    expect(composer).toContain('await import("@vercel/blob/client")');
    expect(redesManager).toContain('handleUploadUrl: "/api/admin/upload/token"');
  });

  it("no permite programar mientras el video no tenga URL pública", () => {
    expect(composer).toMatch(/mediaType === "VIDEO" && !imagen/);
    expect(composer).toContain("Primero sube el video");
  });
});

describe("persistencia del tipo de multimedia", () => {
  const rutaPosts = readFileSync(join(raiz, "app/api/admin/social/posts/route.ts"), "utf8");

  it("guarda VIDEO en metadatos compatibles y conserva scheduledAt", () => {
    expect(rutaPosts).toContain('mediaType: z.enum(["IMAGE", "VIDEO"])');
    expect(rutaPosts).toMatch(/providerResponse: mediaType \? \{ mediaType \}/);
    expect(rutaPosts).toMatch(/scheduledAt,/);
  });
});
