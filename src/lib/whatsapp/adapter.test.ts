import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppChannel } from "@/lib/nurture/channels/whatsapp";
import { parseWhatsAppMode, resolveWhatsAppConfig, resolveWhatsAppWindow, describeWhatsAppConfig } from "./config";

const CREDENTIALS = { phoneNumberId: "111", accessToken: "token-de-prueba", graphVersion: "v25.0" };

/** El doble declara los argumentos de fetch para poder inspeccionar la llamada. */
function respond(status: number, body: unknown, asText?: string) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(asText ?? JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("adaptador de WhatsApp", () => {
  it("no llama a Meta si faltan credenciales, y lo dice", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await new WhatsAppChannel({}).send({ to: "+593999999999", body: "hola" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, errorCode: "WHATSAPP_CREDENTIALS_MISSING" });
  });

  it("envía una plantilla con el payload que espera la Cloud API", async () => {
    const fetchMock = respond(200, { messages: [{ id: "wamid.OK" }] });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new WhatsAppChannel(CREDENTIALS).send({
      to: "+593999999999",
      body: "vista previa legible",
      template: { name: "ra_training_bienvenida_inscripcion", language: "es", components: [{ type: "body", parameters: [] }] },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/111/messages");
    const payload = JSON.parse(init?.body as string);
    expect(payload).toMatchObject({
      messaging_product: "whatsapp",
      to: "+593999999999",
      type: "template",
      template: { name: "ra_training_bienvenida_inscripcion", language: { code: "es" } },
    });
    // El cuerpo legible no viaja: lo que Meta recibe son los parámetros.
    expect(payload.text).toBeUndefined();
    expect(result).toMatchObject({ ok: true, providerMessageId: "wamid.OK", providerName: "whatsapp_cloud" });
  });

  it("usa la versión de Graph configurada y no la de Facebook/Instagram", async () => {
    const fetchMock = respond(200, { messages: [{ id: "wamid.OK" }] });
    vi.stubGlobal("fetch", fetchMock);
    await new WhatsAppChannel({ ...CREDENTIALS, graphVersion: "v23.0" }).send({ to: "+1", body: "x", template: { name: "t", language: "es", components: [] } });
    expect(fetchMock.mock.calls[0][0]).toContain("/v23.0/");
  });

  it("envía texto libre solo si no se le da plantilla", async () => {
    const fetchMock = respond(200, { messages: [{ id: "wamid.OK" }] });
    vi.stubGlobal("fetch", fetchMock);
    await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "respuesta dentro de la ventana" });
    const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(payload).toMatchObject({ type: "text", text: { body: "respuesta dentro de la ventana" } });
  });

  it("trata como fallo un 200 que trae error de Graph en el cuerpo", async () => {
    // Es el caso que inventaría una aceptación: HTTP dice 200 y el cuerpo no.
    vi.stubGlobal("fetch", respond(200, { error: { code: 132001, message: "Template name does not exist" } }));
    const result = await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "x", template: { name: "t", language: "es", components: [] } });
    expect(result).toMatchObject({ ok: false, errorCode: "WHATSAPP_132001", permanent: true });
    expect(result.providerMessageId).toBeUndefined();
  });

  it("trata como fallo un cuerpo que no es JSON aunque el HTTP sea 200", async () => {
    vi.stubGlobal("fetch", respond(200, null, "<html>gateway</html>"));
    const result = await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "x", template: { name: "t", language: "es", components: [] } });
    expect(result).toMatchObject({ ok: false, errorCode: "INVALID_JSON" });
  });

  it("no acepta una respuesta 200 sin wamid: no hay prueba de aceptación", async () => {
    vi.stubGlobal("fetch", respond(200, { messages: [] }));
    const result = await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "x", template: { name: "t", language: "es", components: [] } });
    expect(result).toMatchObject({ ok: false, errorCode: "MISSING_PROVIDER_ID" });
  });

  it("marca permanente un token revocado y recuperable un límite de tasa", async () => {
    vi.stubGlobal("fetch", respond(401, { error: { code: 190, message: "expired" } }));
    expect(await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "x" })).toMatchObject({ errorCode: "WHATSAPP_190", permanent: true });
    vi.stubGlobal("fetch", respond(429, { error: { code: 4, message: "rate limit" } }));
    expect(await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "x" })).toMatchObject({ errorCode: "WHATSAPP_4", permanent: false });
  });

  it("explica en español el rechazo por ventana de 24 horas", async () => {
    vi.stubGlobal("fetch", respond(400, { error: { code: 131047, message: "Re-engagement message" } }));
    const result = await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "x" });
    expect(result.error).toContain("plantilla aprobada");
    expect(result).toMatchObject({ permanent: true });
  });

  it("convierte un fallo de red en un error identificable, no en una excepción", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    const result = await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "x" });
    expect(result).toMatchObject({ ok: false, errorCode: "NETWORK_ERROR" });
  });

  it("nunca incluye el token en el resultado", async () => {
    vi.stubGlobal("fetch", respond(401, { error: { code: 190 } }));
    const result = await new WhatsAppChannel(CREDENTIALS).send({ to: "+1", body: "x" });
    expect(JSON.stringify(result)).not.toContain(CREDENTIALS.accessToken);
  });
});

describe("modo del canal", () => {
  it("cualquier valor no reconocido se interpreta como deshabilitado", () => {
    // "true" u "on" son intenciones ambiguas: no autorizan escribir a nadie.
    for (const raw of [undefined, "", "true", "activo", "LIVE!", "on", "1", "enabled"]) {
      expect(parseWhatsAppMode(raw)).toBe("disabled");
    }
  });

  it("tolera mayúsculas y espacios en los dos valores que sí reconoce", () => {
    expect(parseWhatsAppMode("live")).toBe("live");
    expect(parseWhatsAppMode(" LIVE ")).toBe("live");
    expect(parseWhatsAppMode("Simulation")).toBe("simulation");
  });

  it("sin WHATSAPP_MODE el canal queda bloqueado, no heredado del correo", () => {
    // Heredar MESSAGING_MODE habría puesto WhatsApp en real el mismo día del
    // despliegue, porque el correo ya está en live.
    const window = resolveWhatsAppWindow({ NODE_ENV: "production", MESSAGING_MODE: "live", MESSAGING_LIVE_FROM: "2026-08-01T00:00:00Z" });
    expect(window).toMatchObject({ state: "blocked", errorCode: "WHATSAPP_DISABLED" });
  });

  it("en live sin credenciales bloquea antes de intentar contacto a contacto", () => {
    const window = resolveWhatsAppWindow({ NODE_ENV: "production", WHATSAPP_MODE: "live", WHATSAPP_LIVE_FROM: "2026-08-01T00:00:00Z" });
    expect(window).toMatchObject({ state: "blocked", errorCode: "WHATSAPP_CREDENTIALS_MISSING" });
  });

  it("en live sin fecha de corte bloquea para no vaciar la cola atrasada", () => {
    const base = { NODE_ENV: "production", WHATSAPP_MODE: "live", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t" };
    expect(resolveWhatsAppWindow(base)).toMatchObject({ state: "blocked", errorCode: "LIVE_FROM_MISSING" });
    expect(resolveWhatsAppWindow({ ...base, WHATSAPP_LIVE_FROM: "mañana" })).toMatchObject({ state: "blocked", errorCode: "LIVE_FROM_INVALID" });
    expect(resolveWhatsAppWindow({ ...base, WHATSAPP_LIVE_FROM: "2026-08-08T18:00:00Z" })).toMatchObject({ state: "live" });
  });

  it("Preview y desarrollo simulan aunque el modo diga live", () => {
    const base = { WHATSAPP_MODE: "live", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_LIVE_FROM: "2026-08-01T00:00:00Z" };
    expect(resolveWhatsAppWindow({ ...base, NODE_ENV: "production", VERCEL_ENV: "preview" })).toEqual({ state: "simulation" });
    expect(resolveWhatsAppWindow({ ...base, NODE_ENV: "development" })).toEqual({ state: "simulation" });
  });

  it("el resumen para la interfaz no expone ningún valor", () => {
    vi.stubEnv("WHATSAPP_MODE", "simulation");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "111222333");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token-secretisimo");
    vi.stubEnv("META_APP_SECRET", "secreto-de-app");
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-secreto");
    const resumen = JSON.stringify(describeWhatsAppConfig());
    for (const secreto of ["111222333", "token-secretisimo", "secreto-de-app", "verify-secreto"]) {
      expect(resumen).not.toContain(secreto);
    }
    expect(describeWhatsAppConfig()).toMatchObject({ tokenConfigured: true, appSecretConfigured: true, webhookReady: true });
  });

  it("la versión de Graph tiene un valor por defecto seguro y valida el formato", () => {
    expect(resolveWhatsAppConfig({}).graphVersion).toBe("v25.0");
    expect(resolveWhatsAppConfig({ WHATSAPP_GRAPH_API_VERSION: "23.0" }).graphVersion).toBe("v23.0");
    expect(resolveWhatsAppConfig({ WHATSAPP_GRAPH_API_VERSION: "ultima" }).graphVersion).toBe("v25.0");
  });
});
