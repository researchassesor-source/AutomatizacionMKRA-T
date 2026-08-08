import { resolveChannelWindow } from "@/lib/nurture/engine";
import { formatMoment } from "@/lib/message-presentation";

/**
 * Que va a pasar de verdad cuando llegue la hora de un mensaje.
 *
 * Sin este aviso la pantalla de comunicaciones miente por omision: enseña
 * mensajes "programados" con su hora y su destinatario, y quien la mira asume
 * que van a salir. En simulacion no sale ninguno. La diferencia entre "se
 * enviara" y "se registrara como prueba" no es un detalle tecnico: decide si
 * alguien tiene que avisar por otro medio a los inscritos de mañana.
 *
 * Se muestra a los dos perfiles y sin jerga. Nunca nombra variables de
 * entorno, tokens ni identificadores: dice lo que ocurre, no como se configura.
 */
export function ChannelModeBanner() {
  const correo = resolveChannelWindow("EMAIL");
  const whatsapp = resolveChannelWindow("WHATSAPP");

  const avisos: Array<{ tono: "info" | "warn"; titulo: string; detalle: string }> = [];

  if (correo.state === "simulation") {
    avisos.push({
      tono: "warn",
      titulo: "Modo simulación: ningún correo será enviado.",
      detalle: "Los mensajes se registran como prueba para poder revisarlos, pero no llegan a ningún contacto.",
    });
  } else if (correo.state === "blocked") {
    avisos.push({
      tono: "warn",
      titulo: "El correo está detenido.",
      detalle: correo.error,
    });
  }

  if (whatsapp.state === "simulation") {
    avisos.push({
      tono: "warn",
      titulo: "Modo simulación: ningún WhatsApp será enviado.",
      detalle: "Los mensajes de WhatsApp se registran como prueba para poder revisarlos, pero no llegan a ningún contacto.",
    });
  } else if (whatsapp.state === "blocked") {
    avisos.push({
      tono: "warn",
      titulo: "WhatsApp no está enviando.",
      detalle: whatsapp.error,
    });
  } else if (whatsapp.state === "live") {
    // Estar en real tambien merece decirse. Es el unico estado en el que un
    // error de configuracion llega a una persona de verdad.
    avisos.push({
      tono: "info",
      titulo: "WhatsApp está enviando mensajes reales.",
      detalle: `Solo salen los programados a partir del ${formatMoment(whatsapp.liveFrom)}. Los anteriores quedan sin enviar a propósito.`,
    });
  }

  if (avisos.length === 0) return null;

  return (
    <div className="mode-banners">
      {avisos.map((aviso) => (
        <p key={aviso.titulo} className={`mode-banner is-${aviso.tono}`}>
          <strong>{aviso.titulo}</strong>
          <span>{aviso.detalle}</span>
        </p>
      ))}
    </div>
  );
}
