import { PrismaClient } from "@prisma/client";
import { parseLiveFrom } from "../src/lib/live-activation";

/**
 * Comprobación previa al despliegue. SOLO LECTURA.
 *
 * Responde a una pregunta concreta: si ahora mismo se pusieran MESSAGING_MODE y
 * SOCIAL_MODE en `live`, ¿qué saldría en la primera ejecución del reloj?
 *
 * Los procesadores seleccionan lo vencido (`scheduledAt <= ahora`), no solo lo
 * futuro. Un mensaje o una publicación programados hace semanas siguen en cola
 * y saldrían de inmediato. Este inventario los expone antes de que ocurra.
 *
 *   npx tsx --env-file=.env scripts/deploy-preflight.ts
 */
const prisma = new PrismaClient();
const MAX_ATTEMPTS = 5;

function heading(text: string) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

async function main() {
  const now = new Date();
  console.log(`Comprobación previa al despliegue · ${now.toISOString()}`);
  console.log("Solo lectura: este script no envía, no publica y no modifica nada.");

  heading("1. Correos que saldrían en la primera ejecución");
  const dueMessages = await prisma.outboundMessage.findMany({
    where: {
      OR: [
        { status: "PROGRAMADO", scheduledAt: { lte: now } },
        { status: "FALLIDO", attemptCount: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } },
      ],
    },
    select: { id: true, channel: true, subject: true, scheduledAt: true, status: true, lead: { select: { fullName: true, classification: true, consent: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });
  const sendable = dueMessages.filter((m) => m.lead.classification === "REAL" && m.lead.consent);
  const excluded = dueMessages.length - sendable.length;
  console.log(`Vencidos en cola: ${dueMessages.length}`);
  console.log(`  Se enviarían de verdad: ${sendable.length}`);
  console.log(`  Se omitirían por contacto no REAL o sin consentimiento: ${excluded}`);
  for (const message of sendable.slice(0, 25)) {
    const age = Math.round((now.getTime() - message.scheduledAt.getTime()) / 86_400_000);
    console.log(`  · ${message.channel} · ${message.lead.fullName} · "${message.subject ?? "sin asunto"}" · programado hace ${age} día(s)`);
  }
  if (sendable.length > 25) console.log(`  … y ${sendable.length - 25} más.`);

  heading("2. Publicaciones que saldrían en la primera ejecución");
  const duePosts = await prisma.socialPost.findMany({
    where: { status: "PROGRAMADO", scheduledAt: { lte: now }, account: { isActive: true } },
    select: { id: true, caption: true, scheduledAt: true, account: { select: { platform: true, displayName: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  });
  console.log(`Publicaciones vencidas y programadas: ${duePosts.length}`);
  for (const post of duePosts) {
    console.log(`  · ${post.account.platform} · ${post.account.displayName} · "${post.caption.slice(0, 60)}…" · ${post.scheduledAt?.toISOString()}`);
  }

  heading("3. Recurrencias que generarían publicaciones nuevas");
  const dueSchedules = await prisma.socialSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now }, account: { isActive: true } },
    select: { name: true, nextRunAt: true, account: { select: { platform: true } } },
  });
  console.log(`Recurrencias vencidas y activas: ${dueSchedules.length}`);
  for (const schedule of dueSchedules) {
    console.log(`  · ${schedule.account.platform} · ${schedule.name} · vencida desde ${schedule.nextRunAt.toISOString()}`);
  }

  heading("4. Lo que NO se toca en el primer despliegue");
  const [drafts, cancelled, sentAlready, publishedAlready] = await Promise.all([
    prisma.socialPost.count({ where: { status: "BORRADOR" } }),
    prisma.outboundMessage.count({ where: { status: "CANCELADO" } }),
    prisma.outboundMessage.count({ where: { status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO"] } } }),
    prisma.socialPost.count({ where: { externalPostId: { not: null } } }),
  ]);
  console.log(`Borradores sociales (nunca se publican solos): ${drafts}`);
  console.log(`Mensajes cancelados (no se reactivan): ${cancelled}`);
  console.log(`Mensajes ya enviados (no se reenvían): ${sentAlready}`);
  console.log(`Publicaciones con id de proveedor (no se republican): ${publishedAlready}`);

  heading("5. Fechas de activación configuradas");
  const messagingLiveFrom = parseLiveFrom(process.env.MESSAGING_LIVE_FROM);
  const socialLiveFrom = parseLiveFrom(process.env.SOCIAL_LIVE_FROM);
  console.log(`MESSAGING_LIVE_FROM: ${messagingLiveFrom ? messagingLiveFrom.toISOString() : "sin definir o inválida"}`);
  console.log(`SOCIAL_LIVE_FROM:    ${socialLiveFrom ? socialLiveFrom.toISOString() : "sin definir o inválida"}`);

  const blockedMessages = messagingLiveFrom ? sendable.filter((m) => m.scheduledAt < messagingLiveFrom) : [];
  const blockedPosts = socialLiveFrom ? duePosts.filter((p) => p.scheduledAt && p.scheduledAt < socialLiveFrom) : [];
  if (messagingLiveFrom) console.log(`  Correos vencidos retenidos por la fecha de corte: ${blockedMessages.length}`);
  if (socialLiveFrom) console.log(`  Publicaciones vencidas retenidas por la fecha de corte: ${blockedPosts.length}`);

  heading("Veredicto");
  const queued = sendable.length + duePosts.length + dueSchedules.length;
  const wouldSend = (sendable.length - blockedMessages.length) + (duePosts.length - blockedPosts.length);
  if (queued === 0) {
    console.log("Sin cola vencida. Activar live no dispara nada retroactivo.");
  } else if (messagingLiveFrom && socialLiveFrom) {
    console.log(`Cola vencida: ${queued} elemento(s).`);
    console.log(`Saldrían al activar live: ${wouldSend}. El resto queda retenido por la fecha de corte.`);
    console.log("Las recurrencias anteriores al corte se adelantan solas, sin publicar lo atrasado.");
  } else {
    console.log(`ATENCIÓN: ${queued} elemento(s) en cola vencida y falta al menos una fecha de corte.`);
    console.log("Sin MESSAGING_LIVE_FROM / SOCIAL_LIVE_FROM el canal correspondiente queda bloqueado y no envía nada.");
    console.log("Define la fecha de corte antes de poner live, y cancela desde el panel lo que no deba salir.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo completar la comprobación.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
