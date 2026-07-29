import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { RedesManager } from "./RedesManager";
import { socialConnectionState } from "@/lib/social/orchestrator";

export const dynamic = "force-dynamic";

export default async function SocialPage() {
  const session = await currentAdminSession();
  if (!session || !["ADMIN", "MARKETING"].includes(session.role)) {
    return <main className="container admin-shell"><AdminNav /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para administrar redes sociales." /></main>;
  }
  const [accounts, posts, schedules] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.socialPost.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { account: true } }),
    prisma.socialSchedule.findMany({ orderBy: { nextRunAt: "asc" }, include: { account: true } }),
  ]);
  return <main className="container admin-shell"><AdminNav /><AdminPageHeader eyebrow="Contenido y campañas" title="Redes sociales" description="Coordina cuentas, publicaciones y calendarios de contenido desde un solo lugar." /><RedesManager
    accounts={accounts.map((item) => ({ id: item.id, platform: item.platform, displayName: item.displayName, isActive: item.isActive, connectorState: socialConnectionState(item.platform) }))}
    posts={posts.map((item) => ({ id: item.id, caption: item.caption, mediaUrl: item.mediaUrl, linkUrl: item.linkUrl, status: item.status, account: `${item.account.platform} · ${item.account.displayName}`, scheduledAt: item.scheduledAt?.toISOString() ?? null, error: item.error }))}
    schedules={schedules.map((item) => ({ id: item.id, name: item.name, caption: item.caption, mediaUrl: item.mediaUrl, linkUrl: item.linkUrl, weekday: item.weekday, localTime: item.localTime, isActive: item.isActive, nextRunAt: item.nextRunAt.toISOString(), account: `${item.account.platform} · ${item.account.displayName}` }))}
  /></main>;
}
