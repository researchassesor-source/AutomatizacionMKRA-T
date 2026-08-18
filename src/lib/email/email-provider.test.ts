import { afterEach, describe, expect, it, vi } from "vitest";
import { describeEmailConfig, formatSender, resolveEmailConfig } from "./config";
import { buildEmailDocument, escapeHtml } from "./render";
import { describeSmtpError } from "./smtp";

afterEach(() => vi.unstubAllEnvs());

const smtpEnv = {
  EMAIL_FROM: "avillagomez@ra-training.com",
  EMAIL_FROM_NAME: "R.A. Training",
  EMAIL_REPLY_TO: "avillagomez@ra-training.com",
  SMTP_HOST: "mail.ra-training.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "avillagomez@ra-training.com",
  SMTP_PASSWORD: "valor-de-prueba",
} satisfies Record<string, string | undefined>;

describe("configuración del correo saliente", () => {
  it("elige SMTP cuando hay credenciales completas", () => {
    const config = resolveEmailConfig(smtpEnv);
    expect(config.provider).toBe("smtp");
    expect(config.smtp).toMatchObject({ host: "mail.ra-training.com", port: 465, secure: true });
    if (!config.identity) throw new Error("EMAIL_FROM está definido en smtpEnv: identity no puede ser null aquí.");
    expect(formatSender(config.identity)).toBe("R.A. Training <avillagomez@ra-training.com>");
  });

  it("deduce secure desde el puerto cuando SMTP_SECURE no está definido", () => {
    expect(resolveEmailConfig({ ...smtpEnv, SMTP_SECURE: undefined, SMTP_PORT: "587" }).smtp?.secure).toBe(false);
    expect(resolveEmailConfig({ ...smtpEnv, SMTP_SECURE: undefined, SMTP_PORT: "465" }).smtp?.secure).toBe(true);
  });

  it("conserva Resend como respaldo cuando no hay SMTP", () => {
    const config = resolveEmailConfig({ EMAIL_FROM: "correo@ra-training.com", EMAIL_API_KEY: "clave-de-prueba" });
    expect(config.provider).toBe("resend");
  });

  it("prefiere SMTP frente a Resend si ambos existen", () => {
    expect(resolveEmailConfig({ ...smtpEnv, EMAIL_API_KEY: "clave-de-prueba" }).provider).toBe("smtp");
  });

  it("explica por qué el proveedor queda inactivo", () => {
    expect(resolveEmailConfig({ SMTP_HOST: "mail.ra-training.com" }).reason).toContain("EMAIL_FROM");
    expect(resolveEmailConfig({ EMAIL_FROM: "correo@ra-training.com", EMAIL_PROVIDER: "smtp" }).reason).toContain("SMTP_HOST");
  });

  it("el resumen para la interfaz nunca incluye la contraseña", () => {
    const summary = describeEmailConfig(resolveEmailConfig(smtpEnv));
    expect(JSON.stringify(summary)).not.toContain("valor-de-prueba");
    expect(summary.passwordConfigured).toBe(true);
  });
});

describe("plantilla HTML del correo", () => {
  it("escapa el contenido aportado por el contacto", () => {
    const document = buildEmailDocument({ subject: "Prueba", body: 'Hola <img src=x onerror="alert(1)">' });
    expect(document.html).not.toContain("<img");
    expect(document.html).toContain("&lt;img");
  });

  it("incluye una versión de texto plano idéntica al cuerpo", () => {
    const document = buildEmailDocument({ subject: "Prueba", body: "Hola\n\nSegundo párrafo" });
    expect(document.text).toBe("Hola\n\nSegundo párrafo");
    expect(document.html).toContain("Segundo párrafo");
  });

  it("convierte en enlace únicamente las URL https del contenido", () => {
    const document = buildEmailDocument({ subject: "Prueba", body: "Ingresa en https://meet.example.com/sala" });
    expect(document.html).toContain('<a href="https://meet.example.com/sala"');
    expect(buildEmailDocument({ subject: "Prueba", body: "http://inseguro.example.com" }).html).not.toContain("<a href=");
  });

  it("destaca como bloque de datos las líneas «etiqueta: valor»", () => {
    const document = buildEmailDocument({
      subject: "Prueba",
      body: "Hola Angel\n\nFecha: 12 de agosto de 2026\nHora: 7:30 p. m.\nModalidad: Virtual\n\nGracias",
    });
    expect(document.html).toContain("background-color:#f1f5f9");
    expect(document.html).toContain(">Fecha</span>");
    expect(document.html).toContain("<strong style=\"color:#0f172a;font-size:16px;\">12 de agosto de 2026</strong>");
    // Una hora con dos puntos no debe partirse por su propio separador.
    expect(document.html).toContain(">7:30 p. m.</strong>");
    // El saludo y el cierre siguen siendo párrafos normales.
    expect(document.html).toContain("Hola Angel</p>");
  });

  it("no confunde el «https:» de un enlace con una etiqueta de dato", () => {
    const document = buildEmailDocument({ subject: "Prueba", body: "Ingresa en https://meet.example.com/sala" });
    expect(document.html).not.toContain(">Ingresa en https</span>");
    expect(document.html).toContain('<a href="https://meet.example.com/sala"');
  });

  it("mantiene enlazado el valor de un dato que es una URL", () => {
    const document = buildEmailDocument({ subject: "Prueba", body: "Enlace de acceso: https://meet.example.com/sala" });
    expect(document.html).toContain('<a href="https://meet.example.com/sala"');
    expect(document.html).toContain(">Enlace de acceso</span>");
  });

  it("escapa comillas y ángulos", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("el correo de inscripción explica por qué lo recibe el participante", () => {
    const document = buildEmailDocument({ subject: "Confirmada", body: "Hola" });
    expect(document.html).toContain("porque te inscribiste");
  });

  it("el correo técnico de prueba no dice que alguien se inscribió", () => {
    const document = buildEmailDocument({ subject: "Prueba", body: "Hola", footer: "administrative_test" });
    expect(document.html).not.toContain("porque te inscribiste");
    expect(document.html).toContain("correo técnico de prueba solicitado por una persona administradora");
    expect(document.html).toContain("No corresponde a ninguna inscripción");
  });
});

describe("errores del servidor de correo", () => {
  it("traduce los códigos frecuentes a texto accionable", () => {
    expect(describeSmtpError({ code: "EAUTH" }).error).toContain("autenticar");
    expect(describeSmtpError({ code: "ETIMEDOUT" }).error).toContain("no respondió");
    expect(describeSmtpError({ responseCode: 550 }).errorCode).toBe("SMTP_550");
  });
});
