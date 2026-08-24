import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhookPayload, resolveVerification, verifySignature } from "./webhook";

const SECRET = "secreto-de-prueba-no-real";

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function statusPayload(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: { statuses: [{ id, status, timestamp: "1786000000", ...extra }] } }] }],
  };
}

describe("verificación GET del webhook", () => {
  it("devuelve el challenge cuando el modo y el token son correctos", () => {
    const result = resolveVerification({ mode: "subscribe", token: "token-ok", challenge: "1234567890" }, "token-ok");
    expect(result).toEqual({ ok: true, challenge: "1234567890" });
  });

  it("rechaza con 403 un verify token incorrecto", () => {
    const result = resolveVerification({ mode: "subscribe", token: "token-malo", challenge: "123" }, "token-ok");
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("rechaza un token de longitud distinta sin lanzar", () => {
    // timingSafeEqual exige la misma longitud: la comprobación previa evita la
    // excepción sin revelar nada del valor esperado.
    const result = resolveVerification({ mode: "subscribe", token: "corto", challenge: "123" }, "un-token-mucho-mas-largo");
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("rechaza con 400 si faltan parámetros", () => {
    expect(resolveVerification({ mode: "subscribe", token: "token-ok", challenge: null }, "token-ok")).toMatchObject({ ok: false, status: 400 });
    expect(resolveVerification({ mode: null, token: "token-ok", challenge: "1" }, "token-ok")).toMatchObject({ ok: false, status: 400 });
  });

  it("rechaza un hub.mode que no sea subscribe", () => {
    expect(resolveVerification({ mode: "unsubscribe", token: "token-ok", challenge: "1" }, "token-ok")).toMatchObject({ ok: false, status: 400 });
  });

  it("rechaza si el servidor no tiene verify token configurado", () => {
    expect(resolveVerification({ mode: "subscribe", token: "cualquiera", challenge: "1" }, undefined)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("firma X-Hub-Signature-256", () => {
  const body = JSON.stringify(statusPayload("wamid.ABC", "delivered"));

  it("acepta una firma válida", () => {
    expect(verifySignature(body, sign(body), SECRET)).toEqual({ ok: true });
  });

  it("rechaza una firma calculada con otro secreto", () => {
    expect(verifySignature(body, sign(body, "otro-secreto"), SECRET)).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("rechaza si el cuerpo cambió aunque sea un carácter", () => {
    expect(verifySignature(`${body} `, sign(body), SECRET)).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("rechaza cuando falta la cabecera", () => {
    expect(verifySignature(body, null, SECRET)).toEqual({ ok: false, reason: "MISSING_SIGNATURE" });
  });

  it("rechaza una cabecera con otro algoritmo o mal formada", () => {
    expect(verifySignature(body, `sha1=${"a".repeat(40)}`, SECRET)).toEqual({ ok: false, reason: "MALFORMED_SIGNATURE" });
    expect(verifySignature(body, "sha256=no-es-hexadecimal", SECRET)).toEqual({ ok: false, reason: "MALFORMED_SIGNATURE" });
    expect(verifySignature(body, "sha256=", SECRET)).toEqual({ ok: false, reason: "MALFORMED_SIGNATURE" });
  });

  it("rechaza una firma más corta sin lanzar por longitudes distintas", () => {
    expect(verifySignature(body, "sha256=abcd", SECRET)).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("sin App Secret configurado no acepta nada", () => {
    // Un webhook público sin firma verificada dejaría inventar estados de
    // entrega a cualquiera que conozca la URL.
    expect(verifySignature(body, sign(body), undefined)).toEqual({ ok: false, reason: "MISSING_SECRET" });
  });
});

describe("lectura del payload", () => {
  it("traduce los cuatro estados de Meta", () => {
    for (const [meta, interno] of [["sent", "SENT"], ["delivered", "DELIVERED"], ["read", "READ"], ["failed", "FAILED"]] as const) {
      const parsed = parseWebhookPayload(statusPayload("wamid.X", meta));
      expect(parsed.statuses).toHaveLength(1);
      expect(parsed.statuses[0]).toMatchObject({ providerMessageId: "wamid.X", state: interno });
    }
  });

  it("compone un identificador de evento estable para hacer idempotentes los reintentos", () => {
    const primero = parseWebhookPayload(statusPayload("wamid.X", "delivered")).statuses[0];
    const reintento = parseWebhookPayload(statusPayload("wamid.X", "delivered")).statuses[0];
    expect(primero.providerEventId).toBe("wamid.X:DELIVERED");
    expect(reintento.providerEventId).toBe(primero.providerEventId);
    // Estados distintos del mismo mensaje no colisionan entre sí.
    expect(parseWebhookPayload(statusPayload("wamid.X", "read")).statuses[0].providerEventId).toBe("wamid.X:READ");
  });

  it("convierte el timestamp de segundos epoch", () => {
    const parsed = parseWebhookPayload(statusPayload("wamid.X", "sent"));
    expect(parsed.statuses[0].occurredAt.toISOString()).toBe(new Date(1786000000 * 1000).toISOString());
  });

  it("recoge el motivo cuando Meta reporta failed", () => {
    const parsed = parseWebhookPayload(statusPayload("wamid.X", "failed", {
      errors: [{ code: 131047, title: "Re-engagement message" }],
    }));
    expect(parsed.statuses[0]).toMatchObject({ state: "FAILED", errorCode: "WHATSAPP_131047", errorMessage: "Re-engagement message" });
  });

  it("distingue los mensajes entrantes de los estados y trae su contenido", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { display_phone_number: "+593 99 111 2222" },
            messages: [{ id: "wamid.IN", from: "593999999999", type: "text", text: { body: "hola, información por favor" } }],
            statuses: [{ id: "wamid.OUT", status: "delivered", timestamp: "1786000000" }],
          },
        }],
      }],
    });
    expect(parsed.statuses).toHaveLength(1);
    // El texto ahora SI viaja: la bandeja necesita mostrar lo que la persona
    // escribio. Lo que no viaja es el payload crudo de Meta.
    expect(parsed.inbound[0]).toMatchObject({
      providerMessageId: "wamid.IN",
      type: "text",
      sender: "593999999999",
      businessPhone: "+593 99 111 2222",
      text: "hola, información por favor",
    });
    expect(parsed.inbound[0].occurredAt).toBeInstanceOf(Date);
  });

  it("ignora los campos que no son 'messages' y los deja contados", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "message_template_status_update", value: { event: "APPROVED" } }] }],
    });
    expect(parsed.statuses).toHaveLength(0);
    expect(parsed.ignoredFields).toEqual(["message_template_status_update"]);
  });

  it("no lanza ante payloads malformados", () => {
    // Meta reintenta cualquier respuesta que no sea 200: caerse ante un evento
    // raro convertiría un problema puntual en un bucle de reintentos.
    for (const raro of [null, undefined, 42, "texto", {}, { entry: "no-es-lista" }, { entry: [null] }, { entry: [{ changes: [{}] }] }]) {
      expect(() => parseWebhookPayload(raro)).not.toThrow();
      expect(parseWebhookPayload(raro).statuses).toHaveLength(0);
    }
  });

  it("descarta estados sin identificador o con un estado desconocido", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [
        { status: "delivered", timestamp: "1786000000" },
        { id: "wamid.Y", status: "inventado", timestamp: "1786000000" },
      ] } }] }],
    });
    expect(parsed.statuses).toHaveLength(0);
  });
});

function inboundPayload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { messages: [message] } }] }],
  };
}

/**
 * Bloque 2 del hotfix de multimedia entrante: estos tests CONGELAN el
 * comportamiento que `contenidoDeMensaje` ya tenía antes de este cambio -no
 * se tocó su lógica-. Sirven de base segura antes de construir el proxy de
 * descarga sobre el media_id que aquí se confirma que ya se guarda para los
 * cinco tipos objetivo.
 */
describe("contenido de mensajes multimedia (comportamiento ya existente de contenidoDeMensaje)", () => {
  it("IMAGE: type, media id, mime_type, sha256 y caption", () => {
    const parsed = parseWebhookPayload(inboundPayload({
      id: "wamid.IMG", from: "593999999999", type: "image", timestamp: "1786000000",
      image: { id: "media-img-1", mime_type: "image/jpeg", sha256: "sha-img", caption: "mira esto" },
    }));
    expect(parsed.inbound).toHaveLength(1);
    expect(parsed.inbound[0]).toMatchObject({ type: "image", providerMessageId: "wamid.IMG", text: "mira esto" });
    expect(parsed.inbound[0].mediaMeta).toEqual({ id: "media-img-1", mime_type: "image/jpeg", sha256: "sha-img", caption: "mira esto" });
  });

  it("AUDIO: type, media id, mime_type y sha256 (sin caption, como llegan las notas de voz)", () => {
    const parsed = parseWebhookPayload(inboundPayload({
      id: "wamid.AUD", from: "593999999999", type: "audio", timestamp: "1786000000",
      audio: { id: "media-aud-1", mime_type: "audio/ogg; codecs=opus", sha256: "sha-aud" },
    }));
    expect(parsed.inbound[0]).toMatchObject({ type: "audio", providerMessageId: "wamid.AUD" });
    expect(parsed.inbound[0].text).toBeUndefined();
    expect(parsed.inbound[0].mediaMeta).toEqual({ id: "media-aud-1", mime_type: "audio/ogg; codecs=opus", sha256: "sha-aud" });
  });

  it("VIDEO: type, media id, mime_type y caption", () => {
    const parsed = parseWebhookPayload(inboundPayload({
      id: "wamid.VID", from: "593999999999", type: "video", timestamp: "1786000000",
      video: { id: "media-vid-1", mime_type: "video/mp4", sha256: "sha-vid", caption: "mira este video" },
    }));
    expect(parsed.inbound[0]).toMatchObject({ type: "video", text: "mira este video" });
    expect(parsed.inbound[0].mediaMeta).toMatchObject({ id: "media-vid-1", mime_type: "video/mp4", sha256: "sha-vid" });
  });

  it("DOCUMENT: type, media id, mime_type, filename y caption cuando existe", () => {
    const parsed = parseWebhookPayload(inboundPayload({
      id: "wamid.DOC", from: "593999999999", type: "document", timestamp: "1786000000",
      document: { id: "media-doc-1", mime_type: "application/pdf", sha256: "sha-doc", filename: "contrato.pdf", caption: "aquí está" },
    }));
    expect(parsed.inbound[0]).toMatchObject({ type: "document", text: "aquí está" });
    expect(parsed.inbound[0].mediaMeta).toEqual({ id: "media-doc-1", mime_type: "application/pdf", sha256: "sha-doc", filename: "contrato.pdf", caption: "aquí está" });
  });

  it("DOCUMENT sin caption: filename se conserva igual, sin texto inventado", () => {
    const parsed = parseWebhookPayload(inboundPayload({
      id: "wamid.DOC2", from: "593999999999", type: "document", timestamp: "1786000000",
      document: { id: "media-doc-2", mime_type: "application/pdf", filename: "reporte.pdf" },
    }));
    expect(parsed.inbound[0].text).toBeUndefined();
    expect(parsed.inbound[0].mediaMeta).toMatchObject({ id: "media-doc-2", filename: "reporte.pdf" });
  });

  it("STICKER: type, media id, mime_type, sha256 y animated", () => {
    const parsed = parseWebhookPayload(inboundPayload({
      id: "wamid.STK", from: "593999999999", type: "sticker", timestamp: "1786000000",
      sticker: { id: "media-stk-1", mime_type: "image/webp", sha256: "sha-stk", animated: false },
    }));
    expect(parsed.inbound[0]).toMatchObject({ type: "sticker" });
    expect(parsed.inbound[0].mediaMeta).toEqual({ id: "media-stk-1", mime_type: "image/webp", sha256: "sha-stk", animated: false });
  });

  it("un tipo desconocido conserva el fallback actual (unsupportedType), sin romper el lote", () => {
    const parsed = parseWebhookPayload(inboundPayload({
      id: "wamid.RARO", from: "593999999999", type: "algo_nuevo_de_meta", timestamp: "1786000000",
    }));
    expect(parsed.inbound[0]).toMatchObject({ type: "algo_nuevo_de_meta" });
    expect(parsed.inbound[0].mediaMeta).toEqual({ unsupportedType: "algo_nuevo_de_meta" });
  });

  it("TEXT sigue exactamente igual (sin mediaMeta)", () => {
    const parsed = parseWebhookPayload(inboundPayload({
      id: "wamid.TXT", from: "593999999999", type: "text", timestamp: "1786000000",
      text: { body: "hola" },
    }));
    expect(parsed.inbound[0]).toMatchObject({ type: "text", text: "hola" });
    expect(parsed.inbound[0].mediaMeta).toBeUndefined();
  });
});
