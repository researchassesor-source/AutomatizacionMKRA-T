import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { CONTENIDO } from "@/lib/auth/roles";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { AutomationManager } from "./AutomationManager";
import { PausedRulesPanel } from "./PausedRulesPanel";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (!CONTENIDO.includes(session.role)) {
    return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para administrar automatizaciones." /></main>;
  }
  const [courses, campaigns, rules] = await Promise.all([
    prisma.course.findMany({ where: { isPublished: true }, orderBy: { title: "asc" }, select: { id: true, title: true, startsAt: true, endsAt: true } }),
    prisma.campaign.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        course: { select: { title: true } },
        _count: { select: { enrollments: true, automationRules: true } },
      },
    }),
    prisma.automationRule.findMany({ orderBy: [{ course: { title: "asc" } }, { trigger: "asc" }, { offsetMinutes: "desc" }], include: { course: { select: { title: true } }, campaign: { select: { name: true } }, _count: { select: { messages: true } } } }),
  ]);
  const activeRules = rules.filter((rule) => rule.status === "ACTIVE").length;
  const pausedRules = rules.filter((rule) => rule.status === "PAUSED").length;
  const attentionRules = rules.filter((rule) => rule.status === "DRAFT" || (rule.channel === "WHATSAPP" && !rule.waTemplateName)).length;
  return <main className="container admin-shell">
    <AdminNav view={view} />
    <AdminPageHeader eyebrow="Operación" title="Automatizaciones" description="Consulta campañas y reglas por curso sin perder de vista su estado operativo." />
    <section className="summary-line automation-summary" aria-label="Resumen de automatizaciones"><span><strong>{rules.length}</strong> reglas</span><span className="summary-sep">·</span><span><strong>{activeRules}</strong> activas</span><span className="summary-sep">·</span><span><strong>{pausedRules}</strong> pausadas</span><span className="summary-sep">·</span><span><strong>{attentionRules}</strong> requieren atención</span></section>
    <section className="admin-notice" role="status"><strong>Entorno de simulación:</strong> las reglas conservan su configuración, pero los proveedores reales permanecen desactivados.</section>
    <AutomationManager
      role={session.role}
      courses={courses.map((course) => ({ id: course.id, title: course.title, startsAt: course.startsAt?.toISOString() ?? null, endsAt: course.endsAt?.toISOString() ?? null }))}
      campaigns={campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, code: campaign.code, status: campaign.status, courseId: campaign.courseId, course: campaign.course?.title ?? null, utmCampaign: campaign.utmCampaign, startsAt: campaign.startsAt?.toISOString() ?? null, endsAt: campaign.endsAt?.toISOString() ?? null, enrollments: campaign._count.enrollments, rules: campaign._count.automationRules }))}
      rules={rules.map((rule) => ({ id: rule.id, courseId: rule.courseId, campaignId: rule.campaignId, name: rule.name, trigger: rule.trigger, offsetMinutes: rule.offsetMinutes, channel: rule.channel, subject: rule.subject, body: rule.body, status: rule.status, requiresStreamUrl: rule.requiresStreamUrl, planKey: rule.planKey, waTemplateName: rule.waTemplateName, enrollmentStatuses: Array.isArray(rule.enrollmentStatuses) ? rule.enrollmentStatuses.filter((value): value is string => typeof value === "string") : [], course: rule.course.title, campaign: rule.campaign?.name ?? null, nextExecutionAt: rule.nextExecutionAt?.toISOString() ?? null, lastExecutedAt: rule.lastExecutedAt?.toISOString() ?? null, messages: rule._count.messages }))}
    />
    <PausedRulesPanel canRecover={session.role === "ADMIN"} />
  </main>;
}
