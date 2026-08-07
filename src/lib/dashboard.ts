import { prisma } from "@/lib/db";
import { resolveCourseSessions, upcomingSessions } from "@/lib/course-sessions";

/**
 * Datos del Inicio.
 *
 * Todo sale de la base. Cuando un dato no existe no se rellena con nada: se
 * convierte en una accion pendiente con el sitio donde se resuelve, que es lo
 * unico util que se puede decir de una fecha que nadie ha cargado todavia.
 */
export type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  severity: "warn" | "error";
  /** Curso al que programar una sesion desde el propio aviso. */
  scheduleCourse?: { id: string; title: string; enrollments: number; modality: string | null };
};

export type UpcomingSession = {
  courseId: string;
  courseTitle: string;
  startAt: Date;
  modality: string | null;
  enrollments: number;
  hasStreamUrl: boolean;
};

export type ActivityItem = { id: string; kind: string; text: string; at: Date };

export type DashboardData = {
  contactsThisWeek: number;
  contactsPreviousWeek: number;
  enrollments: number;
  enrollmentsThisWeek: number;
  upcomingSessionsCount: number;
  messagesSent: number;
  messagesSentThisWeek: number;
  attention: AttentionItem[];
  sessions: UpcomingSession[];
  activity: ActivityItem[];
};

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Nombre de la red tal como lo reconoce quien lo lee. */
function redLegible(platform: string): string {
  if (platform === "INSTAGRAM") return "Instagram";
  if (platform === "FACEBOOK") return "Facebook";
  if (platform === "TIKTOK") return "TikTok";
  return platform;
}

export async function loadDashboard(now = new Date()): Promise<DashboardData> {
  const weekAgo = new Date(now.getTime() - WEEK);
  const twoWeeksAgo = new Date(now.getTime() - 2 * WEEK);

  const [
    contactsThisWeek, contactsPreviousWeek, enrollments, enrollmentsThisWeek,
    messagesSent, messagesSentThisWeek, courses, failedPosts, failedMessages, recentLeads, recentMessages, recentPosts,
  ] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: weekAgo }, isArchived: false } }),
    prisma.lead.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo }, isArchived: false } }),
    prisma.enrollment.count(),
    prisma.enrollment.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.outboundMessage.count({ where: { status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO", "LEIDO"] } } }),
    prisma.outboundMessage.count({ where: { status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO", "LEIDO"] }, createdAt: { gte: weekAgo } } }),
    prisma.course.findMany({
      where: { isPublished: true },
      include: { sessions: { orderBy: { startAt: "asc" } }, _count: { select: { enrollments: true } } },
      orderBy: { title: "asc" },
    }),
    prisma.socialPost.findMany({ where: { status: "FALLIDO" }, orderBy: { updatedAt: "desc" }, take: 3, select: { id: true, error: true, updatedAt: true, account: { select: { platform: true } } } }),
    prisma.outboundMessage.count({ where: { status: { in: ["FALLIDO", "REBOTADO"] } } }),
    prisma.lead.findMany({ where: { isArchived: false }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, fullName: true, createdAt: true } }),
    prisma.outboundMessage.findMany({ where: { status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO", "LEIDO"] } }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, subject: true, createdAt: true, lead: { select: { fullName: true } } } }),
    prisma.socialPost.findMany({ where: { status: "PUBLICADO" }, orderBy: { updatedAt: "desc" }, take: 4, select: { id: true, updatedAt: true, account: { select: { platform: true } } } }),
  ]);

  // Sesiones reales de los cursos publicados, ordenadas por proximidad.
  const sessions: UpcomingSession[] = [];
  const sinFecha: Array<{ id: string; title: string; enrollments: number; modality: string | null }> = [];
  const sinEnlace: Array<{ id: string; title: string; startAt: Date }> = [];

  for (const course of courses) {
    const resolved = resolveCourseSessions(course, course.sessions);
    const proximas = upcomingSessions(resolved, now);
    if (resolved.length === 0) {
      // Solo molesta si hay gente esperando: un curso sin inscritos y sin
      // fecha no es un problema todavia.
      if (course._count.enrollments > 0) sinFecha.push({ id: course.id, title: course.title, enrollments: course._count.enrollments, modality: course.modality });
      continue;
    }
    for (const session of proximas) {
      sessions.push({
        courseId: course.id,
        courseTitle: course.title,
        startAt: session.startAt,
        modality: course.modality,
        enrollments: course._count.enrollments,
        hasStreamUrl: Boolean(session.streamUrl),
      });
      if (!session.streamUrl) sinEnlace.push({ id: course.id, title: course.title, startAt: session.startAt });
    }
  }
  sessions.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const dateFormat = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
  const timeFormat = new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" });

  const attention: AttentionItem[] = [];
  for (const item of sinEnlace.slice(0, 2)) {
    attention.push({
      id: `enlace-${item.id}`,
      title: "Falta el enlace de acceso de una sesión",
      detail: `${item.title} · ${dateFormat.format(item.startAt)} · ${timeFormat.format(item.startAt)}. Sin él no pueden salir los avisos de acceso.`,
      href: `/admin/cursos#curso-${item.id}`,
      actionLabel: "Agregar enlace",
      severity: "warn",
    });
  }
  for (const item of sinFecha.slice(0, 2)) {
    attention.push({
      id: `fecha-${item.id}`,
      title: `${item.enrollments} ${item.enrollments === 1 ? "persona está inscrita" : "personas están inscritas"} en un curso que todavía no tiene sesión programada`,
      detail: `${item.title}. Para poder enviar los recordatorios necesitamos definir fecha y hora.`,
      href: "/admin/cursos",
      actionLabel: "Programar sesión",
      severity: "warn",
      scheduleCourse: { id: item.id, title: item.title, enrollments: item.enrollments, modality: item.modality },
    });
  }
  for (const post of failedPosts.slice(0, 2)) {
    attention.push({
      id: `post-${post.id}`,
      title: `Una publicación no salió en ${redLegible(post.account.platform)}`,
      detail: post.error?.slice(0, 140) ?? "La red rechazó la publicación.",
      href: "/admin/redes",
      actionLabel: "Revisar",
      severity: "error",
    });
  }
  if (failedMessages > 0) {
    attention.push({
      id: "mensajes-fallidos",
      title: `${failedMessages} mensaje${failedMessages === 1 ? "" : "s"} no llegó a su destinatario`,
      detail: "Revisa el motivo en Comunicaciones para saber si hay que corregir un dato.",
      href: "/admin/mensajes?status=FALLIDO",
      actionLabel: "Ver",
      severity: "error",
    });
  }

  const activity: ActivityItem[] = [
    ...recentLeads.map((lead) => ({ id: `l-${lead.id}`, kind: "contacto", text: `${lead.fullName} se registró`, at: lead.createdAt })),
    ...recentMessages.map((message) => ({ id: `m-${message.id}`, kind: "mensaje", text: `Se envió «${message.subject ?? "un mensaje"}» a ${message.lead.fullName}`, at: message.createdAt })),
    ...recentPosts.map((post) => ({ id: `p-${post.id}`, kind: "publicacion", text: `Se publicó en ${redLegible(post.account.platform)}`, at: post.updatedAt })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8);

  return {
    contactsThisWeek,
    contactsPreviousWeek,
    enrollments,
    enrollmentsThisWeek,
    upcomingSessionsCount: sessions.length,
    messagesSent,
    messagesSentThisWeek,
    attention: attention.slice(0, 5),
    sessions: sessions.slice(0, 3),
    activity,
  };
}
