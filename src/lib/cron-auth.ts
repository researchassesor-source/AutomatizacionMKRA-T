import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticacion de los disparadores automaticos.
 *
 * Se admiten DOS metodos a la vez, y eso es deliberado:
 *
 *   1. `Authorization: Bearer <CRON_SECRET>` — lo que usa GitHub Actions hoy.
 *   2. Firma `Upstash-Signature` — lo que usara QStash.
 *
 * Durante la migracion los dos relojes conviven. Si el segundo se cambiara por
 * el primero de golpe y la firma quedara mal configurada, los endpoints
 * responderian 401 y NADA se ejecutaria: ni publicaciones ni recordatorios.
 * Aceptar ambos permite comprobar que QStash funciona antes de apagar el otro.
 *
 * La firma es preferible al bearer a medio plazo: no obliga a guardar un
 * secreto compartido en la configuracion de un tercero, incluye la URL de
 * destino y una caducidad, de modo que una peticion capturada no sirve para
 * repetirla mas tarde ni contra otro endpoint.
 */

/** Comparacion en tiempo constante; devuelve false si difieren en longitud. */
function igualSeguro(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function bearerValido(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const supplied = request.headers.get("authorization");
  if (!supplied) return false;
  return igualSeguro(supplied, `Bearer ${secret}`);
}

/** Descodifica base64url, que es como QStash codifica firma y payload. */
function desdeBase64Url(valor: string): Buffer {
  return Buffer.from(valor.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verifica la firma de QStash sobre el cuerpo crudo.
 *
 * QStash envia un JWT firmado con HMAC-SHA256 en `Upstash-Signature`. El
 * `body` del token es el hash SHA-256 del cuerpo, de modo que hay que
 * disponer del cuerpo TAL CUAL llego: si se reserializa el JSON, la firma deja
 * de coincidir aunque el contenido sea el mismo.
 *
 * Se prueban las dos claves porque Upstash las rota: durante la rotacion la
 * actual deja de firmar y empieza la siguiente, y aceptar ambas evita una
 * ventana en la que el reloj queda mudo.
 */
export function verificarFirmaQStash(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const claves = [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY].filter(
    (clave): clave is string => Boolean(clave?.trim()),
  );
  if (claves.length === 0) return false;

  const partes = signature.split(".");
  if (partes.length !== 3) return false;
  const [cabecera, cuerpo, firma] = partes;

  const firmaCoincide = claves.some((clave) => {
    const esperada = createHmac("sha256", clave).update(`${cabecera}.${cuerpo}`).digest("base64url");
    return igualSeguro(firma, esperada);
  });
  if (!firmaCoincide) return false;

  let payload: { exp?: number; nbf?: number; body?: string };
  try {
    payload = JSON.parse(desdeBase64Url(cuerpo).toString("utf8"));
  } catch {
    return false;
  }

  // Una firma valida pero caducada no sirve: es justo lo que tendria alguien
  // que hubiera capturado una peticion anterior.
  const ahora = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < ahora) return false;
  if (typeof payload.nbf === "number" && payload.nbf > ahora + 60) return false;

  // El hash del cuerpo ata la firma a ESTE contenido y no a otro. Se comparan
  // sin el relleno "=" porque QStash lo omite y Node lo incluye.
  if (payload.body) {
    const sha = createHash("sha256").update(rawBody).digest("base64url");
    if (!igualSeguro(payload.body.replace(/=+$/, ""), sha.replace(/=+$/, ""))) return false;
  }

  return true;
}

/**
 * ¿Viene esta peticion de un disparador legitimo?
 *
 * `rawBody` solo hace falta para la firma de QStash. Sin el, se comprueba
 * unicamente el bearer, que es como funcionaba antes.
 */
export function checkCronAuth(request: Request, rawBody?: string): boolean {
  const secret = process.env.CRON_SECRET;
  const firmaQStash = request.headers.get("upstash-signature");

  if (firmaQStash && rawBody !== undefined && verificarFirmaQStash(rawBody, firmaQStash)) return true;
  if (bearerValido(request)) return true;

  // Sin CRON_SECRET ni claves de firma no hay nada que comprobar. Fuera de
  // produccion se permite para poder ejecutar el dispatcher en local; en
  // produccion se rechaza, que es lo unico seguro.
  const sinConfigurar = !secret
    && !process.env.QSTASH_CURRENT_SIGNING_KEY
    && !process.env.QSTASH_NEXT_SIGNING_KEY;
  if (sinConfigurar) return process.env.NODE_ENV !== "production";

  return false;
}
