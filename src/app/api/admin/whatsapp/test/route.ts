import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { TECNICO } from "@/lib/auth/roles";
import { normalizeEcuadorPhone } from "@/lib/lead-validation";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { WhatsAppChannel } from "@/lib/nurture/channels/whatsapp";
import {
  describeWhatsAppConfig,
  resolveWhatsAppConfig,
  resolveWhatsAppWindow,
  toWhatsAppRecipient,
} from "@/lib/whatsapp/config";
import { buildTemplateComponents, fillTemplateBody, WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from "@/lib/whatsapp/templates";

export const dynamic = "force-dynamic";

/**
 * Prueba controlada de WhatsApp.
 *
 * Dos cosas distintas, y a proposito en el mismo sitio:
 *
 *   1. Vista previa (sin `to`): arma el envio exactamente como saldria y lo
 *      devuelve para leerlo. No llama a Meta. Es lo que permite comprobar que
 *      la plantilla tiene el numero de parametros correcto ANTES de que un
 *      contacto reciba nada, que es donde se descubren si no.
 *
 *   2. Envio unico (con `to`): una sola plantilla a un numero que indica quien
 *      administra.
 *
 * El envio NO puentea el estado del canal. Si WhatsApp esta en simulacion o
 * bloqueado, esta ruta tampoco envia: devuelve la vista previa y lo dice. Un
 * "boton de prueba" que enviara de verdad estando el canal en simulacion
 * convertiria el propio interruptor de seguridad en decorativo, y es el
 * interruptor del que depende que nadie reciba nada por accidente.
 */

/** Valores de ejemplo de la vista previa. No salen de ningun contacto real. */
const EJEMPLO: Record<string, string> = {
  nombre: "Nombre de prueba",
  curso: "Curso de prueba",
  fecha: "20 de agosto de 2026",
  hora: "7:30 p. m.",
  fechaSesion: "20 de agosto de 2026",
  horaSesion: "7:30 p. m.",
  streamUrl: "https://meet.google.com/prueba-crm",
  // Numeros sueltos, como los devuelve el motor: los textos ya escriben
  // "Sesión {{n}} de {{total}}" alrededor.
  numero_sesion: "1",
  total_sesiones: "3",
  proxima_sesion: "22 de agosto de 2026 · 7:30 p. m.",
  link_grupo_whatsapp: "https://chat.whatsapp.com/prueba-crm",
  link_curso_completo: "https://ra-training.com/curso-completo",
  link_encuesta: "https://ra-training.com/encuesta",
  link_oferta_institucional: "https://ra-training.com/certificacion",
};

const schema = z.object({
  confirm: z.literal(true),
  template: z.enum(Object.keys(WHATSAPP_TEMPLATES) as [WhatsAppTemplateKey, ...WhatsAppTemplateKey[]]),
  to: z.string().trim().min(7).max(20).optional(),
});

export async function POST(request: Request) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;

  const limit = await checkRateLimit(requestKey(request, "whatsapp-test"), { limit: 5, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Se alcanzó el límite de pruebas de WhatsApp. Espera unos minutos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Debes confirmar la prueba y elegir una plantilla." }, { status: 422 });
  }

  const spec = WHATSAPP_TEMPLATES[parsed.data.template];
  const binding = { name: spec.name, language: spec.language, bodyVars: [...spec.bodyVars], urlVar: spec.urlVar ?? null };
  const built = buildTemplateComponents(binding, EJEMPLO);
  if (!built.ok) {
    // Si la vista previa no se puede armar, el envio real tampoco: es un
    // desajuste entre el catalogo y las variables del motor.
    return NextResponse.json({ ok: false, errorCode: built.errorCode, error: built.error }, { status: 422 });
  }

  const preview = {
    plantilla: spec.name,
    idioma: spec.language,
    parametros: spec.bodyVars.map((variable, index) => ({
      posicion: `{{${index + 1}}}`,
      variable,
      valorDeEjemplo: EJEMPLO[variable],
    })),
    // El mensaje tal como lo recibiria un contacto: el texto registrado en
    // Meta con los valores de ejemplo ya puestos. Ver el texto final, y no una
    // parafrasis, es la unica forma de detectar que la plantilla del panel y
    // la registrada en Meta han dejado de ser la misma.
    mensaje: fillTemplateBody(spec, (variable) => EJEMPLO[variable] ?? `{{${variable}}}`),
    textoRegistrado: spec.sample,
  };

  const estado = describeWhatsAppConfig();

  if (!parsed.data.to) {
    await writeAudit({
      session: auth.session,
      action: "WHATSAPP_TEST_PREVIEWED",
      entityType: "WhatsAppTemplate",
      metadata: { plantilla: spec.name, parametros: spec.bodyVars.length, modo: estado.mode },
    });
    return NextResponse.json({
      ok: true,
      sent: false,
      preview,
      estado,
      message: `Vista previa de ${spec.name} con ${spec.bodyVars.length} parámetro(s). No se contactó a Meta ni a ningún número.`,
    });
  }

  let destino: string;
  try {
    destino = normalizeEcuadorPhone(parsed.data.to);
  } catch (err) {
    return NextResponse.json({ ok: false, preview, error: (err as Error).message }, { status: 422 });
  }

  const window = resolveWhatsAppWindow();
  if (window.state !== "live") {
    await writeAudit({
      session: auth.session,
      action: "WHATSAPP_TEST_BLOCKED",
      entityType: "WhatsAppTemplate",
      result: "FAILURE",
      metadata: { plantilla: spec.name, modo: estado.mode, ventana: window.state },
    });
    return NextResponse.json({
      ok: false,
      sent: false,
      preview,
      estado,
      error: window.state === "simulation"
        ? "El canal está en modo simulación, así que no se envió nada. Arriba tienes la vista previa exacta de lo que saldría."
        : window.error,
    }, { status: 409 });
  }

  const config = resolveWhatsAppConfig();
  const result = await new WhatsAppChannel({
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    graphVersion: config.graphVersion,
  }).send({
    to: toWhatsAppRecipient(destino),
    body: spec.sample,
    template: { name: spec.name, language: spec.language, components: built.components },
    reference: "prueba-administrativa",
  });

  await writeAudit({
    session: auth.session,
    action: "WHATSAPP_TEST_SENT",
    entityType: "WhatsAppTemplate",
    result: result.ok ? "SUCCESS" : "FAILURE",
    // El numero no se audita completo: basta con los ultimos digitos para
    // reconocer cual fue sin dejar un dato personal escrito.
    metadata: {
      plantilla: spec.name,
      destinoParcial: `…${destino.slice(-4)}`,
      aceptado: result.ok,
      errorCode: result.ok ? null : result.errorCode ?? null,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, sent: false, preview, estado, errorCode: result.errorCode, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true, preview, estado, message: `Se envió ${spec.name} a …${destino.slice(-4)}.` });
}
