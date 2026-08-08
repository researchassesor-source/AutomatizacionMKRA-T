import { describe, expect, it, vi } from "vitest";
import { buildWhatsAppLogLine, logWhatsAppEvent, type WhatsAppLogEvent } from "./observability";

const AHORA = new Date("2026-08-08T18:00:00.000Z");

describe("traza de envíos de WhatsApp", () => {
  it("registra lo necesario para investigar un rechazo de Meta", () => {
    const linea = buildWhatsAppLogLine({
      evento: "envio_rechazado",
      plantilla: "ra_training_acceso_15min",
      idioma: "es",
      mensajeId: "msg_1",
      codigo: "WHATSAPP_132000",
      httpStatus: 400,
      graphCode: 132_000,
      permanente: true,
    }, AHORA);

    expect(linea).toEqual({
      canal: "whatsapp",
      evento: "envio_rechazado",
      ts: "2026-08-08T18:00:00.000Z",
      plantilla: "ra_training_acceso_15min",
      idioma: "es",
      mensajeId: "msg_1",
      codigo: "WHATSAPP_132000",
      httpStatus: 400,
      graphCode: 132_000,
      permanente: true,
    });
  });

  it("descarta cualquier campo que no esté en la lista permitida", () => {
    // El riesgo real no es que alguien escriba el token a proposito, sino que
    // pase el objeto de configuracion entero "para tener mas contexto". La
    // lista cerrada hace que eso no llegue a los registros.
    const contaminado = {
      evento: "envio_aceptado",
      plantilla: "ra_training_acceso_2h",
      idioma: "es",
      wamid: "wamid.HBg",
      mensajeId: "msg_2",
      httpStatus: 200,
      accessToken: "EAAG-token-secreto",
      appSecret: "secreto",
      phoneNumberId: "000000000000000",
      to: "593959015655",
      body: "Hola Angel, tu sesión empieza…",
    } as unknown as WhatsAppLogEvent;

    const serializado = JSON.stringify(buildWhatsAppLogLine(contaminado, AHORA));
    expect(serializado).not.toMatch(/EAAG-token-secreto|secreto|000000000000000|593959015655|Hola Angel/);
    expect(serializado).toContain("ra_training_acceso_2h");
    expect(serializado).toContain("wamid.HBg");
  });

  it("escribe una sola línea de JSON, y los fallos como advertencia", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logWhatsAppEvent({ evento: "envio_aceptado", plantilla: "t", idioma: "es", wamid: "w", mensajeId: "m", httpStatus: 200 }, AHORA);
    logWhatsAppEvent({ evento: "envio_bloqueado", codigo: "WHATSAPP_DISABLED", mensajeId: "m", plantilla: null }, AHORA);

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    for (const spy of [info, warn]) {
      const salida = spy.mock.calls[0][0] as string;
      // Un texto con saltos se parte en varias entradas y deja de poder buscarse.
      expect(salida).not.toContain("\n");
      expect(() => JSON.parse(salida)).not.toThrow();
    }

    info.mockRestore();
    warn.mockRestore();
  });
});
