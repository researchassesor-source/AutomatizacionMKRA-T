import { prisma } from "@/lib/db";
import { describeEmailConfig, resolveEmailConfig } from "@/lib/email/config";
import { resolveMessagingWindow, resolveSocialWindow } from "@/lib/live-activation";
import { describeWhatsAppConfig } from "@/lib/whatsapp/config";
import { relativeMoment } from "@/lib/message-presentation";

/**
 * Franja de salud, solo en la vista tecnica.
 *
 * Cinco puntos. Si todo esta verde no hay nada que leer; si uno cambia de
 * color, ya se sabe donde entrar sin abrir cinco pantallas de diagnostico.
 */
type Punto = { label: string; state: "ok" | "warn" | "err"; detail: string };

export async function HealthStrip() {
  const [ultimoEnvio, publicacionesFallidas] = await Promise.all([
    prisma.outboundMessage.findFirst({
      where: { status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO", "LEIDO"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.socialPost.count({ where: { status: "FALLIDO" } }),
  ]);

  const email = describeEmailConfig(resolveEmailConfig());
  const messaging = resolveMessagingWindow();
  const social = resolveSocialWindow();
  const whatsapp = describeWhatsAppConfig();

  const puntos: Punto[] = [
    {
      label: "Correo",
      state: messaging.state === "blocked" ? "err" : email.provider === "none" ? "warn" : messaging.state === "live" ? "ok" : "warn",
      detail: messaging.state === "blocked" ? "incidencia" : email.provider === "none" ? "requiere configuración" : messaging.state === "live" ? "operativo" : "en simulación",
    },
    {
      label: "WhatsApp",
      state: whatsapp.mode === "disabled" ? "warn" : whatsapp.windowState === "blocked" ? "err" : whatsapp.windowState === "live" ? "ok" : "warn",
      detail: whatsapp.mode === "disabled" ? "requiere configuración" : whatsapp.windowState === "live" ? "operativo" : "en simulación",
    },
    {
      label: "Redes",
      state: publicacionesFallidas > 0 ? "err" : social.state === "live" ? "ok" : "warn",
      detail: publicacionesFallidas > 0 ? `${publicacionesFallidas} incidencias` : social.state === "live" ? "operativo" : "en simulación",
    },
    {
      label: "Último envío",
      state: ultimoEnvio ? "ok" : "warn",
      detail: ultimoEnvio ? relativeMoment(ultimoEnvio.createdAt) : "ninguno todavía",
    },
  ];

  return (
    <section className="health-strip" aria-label="Estado de las integraciones">
      {puntos.map((punto) => (
        <span className={`health-item is-${punto.state}`} key={punto.label}>
          {punto.label} <em>{punto.detail}</em>
        </span>
      ))}
    </section>
  );
}
