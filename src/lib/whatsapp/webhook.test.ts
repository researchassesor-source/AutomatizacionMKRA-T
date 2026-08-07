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

  it("distingue los mensajes entrantes de los estados y no guarda su contenido", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            messages: [{ id: "wamid.IN", from: "593999999999", type: "text", text: { body: "hola, información por favor" } }],
            statuses: [{ id: "wamid.OUT", status: "delivered", timestamp: "1786000000" }],
          },
        }],
      }],
    });
    expect(parsed.statuses).toHaveLength(1);
    expect(parsed.inbound).toEqual([{ providerMessageId: "wamid.IN", type: "text" }]);
    expect(JSON.stringify(parsed)).not.toContain("información por favor");
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
