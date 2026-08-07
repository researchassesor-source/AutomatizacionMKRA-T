/**
 * Construccion del HTML de los correos.
 *
 * El cuerpo que se guarda en `outbound_messages.body` es texto plano: asi se
 * lee tal cual en el panel administrativo y se reutiliza como alternativa
 * `text/plain`. El HTML se arma aqui escapando todo el contenido, de modo que
 * ningun dato aportado por un contacto pueda inyectar marcado.
 */
const BRAND_NAME = "R.A. Training";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Solo se convierten en enlaces las URL https propias del contenido. */
function linkify(escapedLine: string): string {
  return escapedLine.replace(/https:\/\/[^\s<]+/g, (url) => {
    const trimmed = url.replace(/[.,;:)]+$/, "");
    const trailing = url.slice(trimmed.length);
    return `<a href="${trimmed}" style="color:#0b5cab;text-decoration:underline;word-break:break-all;">${trimmed}</a>${trailing}`;
  });
}

/**
 * Una línea del tipo «Etiqueta: valor» se muestra como dato destacado y no como
 * texto corrido. Fecha, hora y enlace son justo lo que el participante busca de
 * un vistazo, y perderlos dentro de un párrafo obliga a releer el correo entero.
 *
 * Se exige un espacio tras los dos puntos: es lo que separa un dato real de los
 * dos puntos de un esquema de URL. Sin esa condición, «Ingresa en https://…»
 * se partiría por `https:` y el enlace quedaría roto.
 */
const DATA_LINE = /^([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,22}):[ \t]+(\S.*)$/;

function renderLine(line: string): string {
  const match = line.match(DATA_LINE);
  if (!match) return linkify(escapeHtml(line));
  return `<span style="display:inline-block;min-width:80px;color:#64748b;font-size:14px;">${escapeHtml(match[1])}</span>`
    + `<strong style="color:#0f172a;font-size:16px;">${linkify(escapeHtml(match[2]))}</strong>`;
}

function paragraphs(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      // Un bloque en el que todas las líneas son datos se destaca visualmente.
      if (lines.length > 0 && lines.every((line) => DATA_LINE.test(line))) {
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:#f1f5f9;border-radius:10px;">'
          + '<tr><td style="padding:15px 18px;border-left:3px solid #0b3d68;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">'
          + lines.map((line) => `<div style="margin:4px 0;line-height:1.6;">${renderLine(line)}</div>`).join("")
          + "</td></tr></table>";
      }
      return `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#334155;">${lines.map(renderLine).join("<br />")}</p>`;
    })
    .join("");
}

export type EmailDocument = { subject: string; html: string; text: string };

/**
 * Pie del mensaje. El correo de inscripción explica por qué lo recibe el
 * participante; el correo técnico de prueba no puede decir lo mismo, porque
 * nadie se inscribió: lo pidió una persona administradora.
 */
export type EmailFooterKind = "enrollment" | "administrative_test";

function footerText(kind: EmailFooterKind, brand: string): string {
  return kind === "administrative_test"
    ? `Este es un correo técnico de prueba solicitado por una persona administradora de ${brand} para verificar la configuración del servidor de salida. No corresponde a ninguna inscripción y no requiere ninguna acción.`
    : `Recibes este correo porque te inscribiste en una actividad de ${brand}. Si no reconoces esta inscripción, responde a este mensaje y lo revisamos.`;
}

/**
 * Envuelve el cuerpo en una plantilla responsive de una sola columna. Se usan
 * estilos en linea y tablas porque es lo unico que los clientes de correo
 * (Gmail, Outlook) renderizan de forma predecible.
 */
export function buildEmailDocument(input: {
  subject: string;
  body: string;
  brandName?: string;
  footer?: EmailFooterKind;
}): EmailDocument {
  const brand = input.brandName ?? BRAND_NAME;
  const subject = input.subject.trim();
  const body = input.body.trim();
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;border:1px solid #e3e8ee;">
<tr><td style="padding:24px 28px 8px;border-bottom:1px solid #eef1f5;">
<span style="font-size:18px;font-weight:700;color:#0b3d68;letter-spacing:0.2px;">${escapeHtml(brand)}</span>
</td></tr>
<tr><td style="padding:24px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
${paragraphs(body)}
</td></tr>
<tr><td style="padding:8px 28px 24px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0;font-size:12px;line-height:1.5;color:#6b7684;">${escapeHtml(footerText(input.footer ?? "enrollment", brand))}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject, html, text: body };
}
