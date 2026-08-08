import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { CONTENIDO } from "@/lib/auth/roles";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { IntegrationStatusPanel } from "../IntegrationStatusPanel";
import { RedesManager } from "./RedesManager";
import { TikTokPanel } from "./TikTokPanel";
import { socialConnectionState } from "@/lib/social/orchestrator";

export const dynamic = "force-dynamic";

export default async function SocialPage() {
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (!session || !CONTENIDO.includes(session.role)) {
    return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para administrar redes sociales." /></main>;
  }
  const [accounts, posts, schedules] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.socialPost.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { account: true } }),
    prisma.socialSchedule.findMany({ orderBy: { nextRunAt: "asc" }, include: { account: true } }),
  ]);
  return <main className="container admin-shell"><AdminNav view={view} /><AdminPageHeader eyebrow="Contenido y campañas" title="Redes sociales" description="Publica y programa contenido en Facebook, Instagram y TikTok." /><IntegrationStatusPanel technical={view === "tecnica"} only={view === "tecnica" ? ["facebook", "instagram", "tiktok", "whatsapp", "meta_ads"] : ["facebook", "instagram", "tiktok"]} />{view === "tecnica" ? <TikTokPanel /> : null}<RedesManager
    accounts={accounts.map((item) => ({ id: item.id, platform: item.platform, displayName: item.displayName, externalId: item.externalId, isActive: item.isActive, connectorState: socialConnectionState(item.platform), connectionStatus: item.connectionStatus, connectionCheckedAt: item.connectionCheckedAt?.toISOString() ?? null, connectionError: item.connectionError }))}
    posts={posts.map((item) => ({ id: item.id, caption: item.caption, mediaUrl: item.mediaUrl, linkUrl: item.linkUrl, status: item.status, account: `${item.account.platform} · ${item.account.displayName}`, scheduledAt: item.scheduledAt?.toISOString() ?? null, error: item.errorMessage ?? item.error, errorCode: item.errorCode, providerPostUrl: item.providerPostUrl, externalPostId: item.externalPostId }))}
    schedules={schedules.map((item) => ({ id: item.id, name: item.name, caption: item.caption, mediaUrl: item.mediaUrl, linkUrl: item.linkUrl, weekday: item.weekday, localTime: item.localTime, isActive: item.isActive, nextRunAt: item.nextRunAt.toISOString(), account: `${item.account.platform} · ${item.account.displayName}` }))}
  /></main>;
}
