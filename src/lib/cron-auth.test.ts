import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCronAuth, verificarFirmaQStash } from "./cron-auth";

const CLAVE = "clave-de-firma-de-prueba";
const SECRETO = "secreto-de-cron-de-prueba";

/** Construye un JWT como el que envía QStash en `Upstash-Signature`. */
function firmar(cuerpo: string, clave = CLAVE, ajustes: Record<string, unknown> = {}): string {
  const cabecera = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "Upstash",
      exp: Math.floor(Date.now() / 1000) + 300,
      nbf: Math.floor(Date.now() / 1000) - 10,
      body: createHash("sha256").update(cuerpo).digest("base64url"),
      ...ajustes,
    }),
  ).toString("base64url");
  const firma = createHmac("sha256", clave).update(`${cabecera}.${payload}`).digest("base64url");
  return `${cabecera}.${payload}.${firma}`;
}

function peticion(headers: Record<string, string>): Request {
  return new Request("https://ejemplo.test/api/social/publish", { method: "POST", headers });
}

const entornoOriginal = { ...process.env };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  delete process.env.CRON_SECRET;
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
});
afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...entornoOriginal };
});

describe("firma de QStash", () => {
  it("acepta una firma válida sobre ese cuerpo exacto", () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE;
    const cuerpo = '{"origen":"qstash"}';
    expect(verificarFirmaQStash(cuerpo, firmar(cuerpo))).toBe(true);
  });

  it("rechaza la firma si el cuerpo cambió", () => {
    // Es la garantía de que nadie reutiliza una firma legítima con otro contenido.
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE;
    expect(verificarFirmaQStash('{"origen":"otro"}', firmar('{"origen":"qstash"}'))).toBe(false);
  });

  it("rechaza una firma hecha con otra clave", () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE;
    expect(verificarFirmaQStash("{}", firmar("{}", "clave-que-no-es"))).toBe(false);
  });

  it("acepta la clave siguiente, para que la rotación no deje el reloj mudo", () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE;
    process.env.QSTASH_NEXT_SIGNING_KEY = "la-siguiente";
    expect(verificarFirmaQStash("{}", firmar("{}", "la-siguiente"))).toBe(true);
  });

  it("rechaza una firma caducada", () => {
    // Es justo lo que tendría alguien que hubiera capturado una petición vieja.
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE;
    const vencida = firmar("{}", CLAVE, { exp: Math.floor(Date.now() / 1000) - 60 });
    expect(verificarFirmaQStash("{}", vencida)).toBe(false);
  });

  it("rechaza basura y ausencia de firma", () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE;
    expect(verificarFirmaQStash("{}", null)).toBe(false);
    expect(verificarFirmaQStash("{}", "no-es-un-jwt")).toBe(false);
    expect(verificarFirmaQStash("{}", "a.b.c")).toBe(false);
  });

  it("sin claves configuradas no valida nada", () => {
    expect(verificarFirmaQStash("{}", firmar("{}"))).toBe(false);
  });
});

describe("los dos relojes conviven durante la migración", () => {
  it("acepta el bearer de GitHub Actions", () => {
    process.env.CRON_SECRET = SECRETO;
    expect(checkCronAuth(peticion({ authorization: `Bearer ${SECRETO}` }), "")).toBe(true);
  });

  it("acepta la firma de QStash con el mismo endpoint", () => {
    process.env.CRON_SECRET = SECRETO;
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE;
    const cuerpo = "{}";
    expect(checkCronAuth(peticion({ "upstash-signature": firmar(cuerpo) }), cuerpo)).toBe(true);
  });

  it("rechaza un bearer equivocado aunque haya firma configurada", () => {
    process.env.CRON_SECRET = SECRETO;
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE;
    expect(checkCronAuth(peticion({ authorization: "Bearer otro-secreto" }), "")).toBe(false);
  });

  it("rechaza una petición sin credenciales", () => {
    process.env.CRON_SECRET = SECRETO;
    expect(checkCronAuth(peticion({}), "")).toBe(false);
  });

  it("en producción sin ninguna configuración no deja pasar nada", () => {
    // Fallar cerrado: es preferible que el reloj no dispare a que lo dispare
    // cualquiera desde fuera.
    expect(checkCronAuth(peticion({}), "")).toBe(false);
  });

  it("fuera de producción permite ejecutar el dispatcher en local", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(checkCronAuth(peticion({}), "")).toBe(true);
  });
});
