import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeSmtpError, detalleSmtp } from "./smtp";

/**
 * El detalle que se guarda de un fallo SMTP.
 *
 * La auditoria guardaba solo `errorCode: "EENVELOPE"`, y ese codigo no
 * distingue un buzon inexistente de un relay denegado para toda la cuenta. Con
 * 572 fallos seguidos no habia forma de saber cual de los dos era, porque la
 * respuesta del servidor se descartaba en el momento de capturarla.
 */

/** Error tal como lo lanza nodemailer cuando el servidor rechaza el sobre. */
const ERROR_REAL = {
  code: "EENVELOPE",
  responseCode: 550,
  command: "RCPT TO",
  response: "550 5.7.1 Relay denied: exceeded the max emails per hour (200 max)",
  message: "Can't send mail - all recipients were rejected",
  rejected: ["david005espinoza@gmail.com"],
  rejectedErrors: [
    { recipient: "david005espinoza@gmail.com", responseCode: 550, response: "550 5.7.1 Relay denied" },
  ],
};

describe("captura del fallo SMTP", () => {
  it("conserva los seis datos que hacen falta para diagnosticar", () => {
    expect(detalleSmtp(ERROR_REAL)).toEqual({
      respuesta: "550 5.7.1 Relay denied: exceeded the max emails per hour (200 max)",
      codigoSmtp: 550,
      etapa: "RCPT TO",
      mensaje: "Can't send mail - all recipients were rejected",
      rechazados: ["david005espinoza@gmail.com"],
      erroresPorDestinatario: [
        { destinatario: "david005espinoza@gmail.com", codigoSmtp: 550, respuesta: "550 5.7.1 Relay denied" },
      ],
    });
  });

  it("separa la respuesta del servidor del mensaje de nodemailer", () => {
    // No siempre coinciden, y la del servidor es la que manda: es la unica que
    // dice el motivo real.
    const detalle = detalleSmtp(ERROR_REAL);
    expect(detalle.respuesta).not.toBe(detalle.mensaje);
    expect(detalle.respuesta).toContain("max emails per hour");
  });

  it("el motivo por destinatario permite distinguir buzón inválido de relay denegado", () => {
    const variosBuzones = detalleSmtp({
      ...ERROR_REAL,
      rejected: ["uno@ejemplo.com", "dos@ejemplo.com"],
      rejectedErrors: [
        { recipient: "uno@ejemplo.com", responseCode: 550, response: "550 No such user" },
        { recipient: "dos@ejemplo.com", responseCode: 550, response: "550 Relay denied" },
      ],
    });
    expect(variosBuzones.erroresPorDestinatario.map((e) => e.respuesta)).toEqual(["550 No such user", "550 Relay denied"]);
  });

  it("tolera un error que no trae ninguno de esos campos", () => {
    expect(detalleSmtp(new Error("algo raro"))).toMatchObject({
      respuesta: null,
      codigoSmtp: null,
      etapa: null,
      mensaje: "algo raro",
      rechazados: [],
      erroresPorDestinatario: [],
    });
    expect(detalleSmtp(null)).toMatchObject({ respuesta: null, rechazados: [], erroresPorDestinatario: [] });
    expect(detalleSmtp(undefined).mensaje).toBeNull();
  });

  it("recorta lo que llega para no volcar respuestas enormes en la auditoría", () => {
    const detalle = detalleSmtp({ response: "x".repeat(900), message: "y".repeat(900), command: "z".repeat(120) });
    expect(detalle.respuesta).toHaveLength(300);
    expect(detalle.mensaje).toHaveLength(300);
    expect(detalle.etapa).toHaveLength(40);
  });

  it("acota cuántos destinatarios rechazados guarda", () => {
    const muchos = Array.from({ length: 40 }, (_, i) => `persona${i}@ejemplo.com`);
    const detalle = detalleSmtp({ rejected: muchos, rejectedErrors: muchos.map((r) => ({ recipient: r })) });
    expect(detalle.rechazados).toHaveLength(10);
    expect(detalle.erroresPorDestinatario).toHaveLength(10);
  });
});

describe("el detalle viaja junto al mensaje humano", () => {
  it("describeSmtpError devuelve código, texto y detalle", () => {
    const descrito = describeSmtpError(ERROR_REAL);
    expect(descrito.errorCode).toBe("EENVELOPE");
    expect(descrito.detalle.codigoSmtp).toBe(550);
    expect(descrito.detalle.respuesta).toContain("Relay denied");
  });

  it("EENVELOPE no acusa al destinatario", () => {
    // Cubre remitente, destinatario y relay. Traducirlo como problema del
    // destinatario mando a revisar direcciones que eran correctas.
    expect(describeSmtpError({ code: "EENVELOPE" }).error).toContain("remitente o destinatario");
  });
});

describe("el endpoint de prueba lo guarda en la auditoría", () => {
  const ruta = readFileSync(join(process.cwd(), "src/app/api/admin/email/test/route.ts"), "utf8");

  it("aplana los seis campos con nombres buscables", () => {
    for (const campo of ["smtpResponse", "smtpResponseCode", "smtpCommand", "smtpMessage", "smtpRejected", "smtpRejectedErrors"]) {
      expect(ruta, `falta ${campo} en la auditoría`).toContain(campo);
    }
  });

  it("los adjunta tanto al fallo de conexión como al de envío", () => {
    // Son dos etapas distintas del mismo diagnostico: la autenticacion puede
    // pasar y el sobre fallar despues, que es exactamente lo que ocurrio.
    expect(ruta.match(/auditoriaSmtp\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("no guarda el detalle cuando el envío salió bien", () => {
    expect(ruta).toMatch(/result\.ok \? \{\} : auditoriaSmtp\(result\.detalle\)/);
  });
});

describe("nada de esto puede filtrar credenciales", () => {
  it("no copia campos ajenos al diálogo SMTP", () => {
    const conBasura = {
      ...ERROR_REAL,
      auth: { user: "avillagomez@ra-training.com", pass: "clave-secreta-de-prueba" },
      settings: { password: "otra-clave" },
    };
    const serializado = JSON.stringify(detalleSmtp(conBasura));
    expect(serializado).not.toContain("clave-secreta-de-prueba");
    expect(serializado).not.toContain("otra-clave");
    expect(serializado).not.toContain("pass");
  });
});
