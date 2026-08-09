import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { CONTENIDO } from "@/lib/auth/roles";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { IntegrationStatusPanel } from "../IntegrationStatusPanel";
import { cuentasCanonicasPorRed } from "@/lib/social/cuentas";
import { RedesManager } from "./RedesManager";
import { PublishComposer } from "./PublishComposer";
import { PostsBoard } from "./PostsBoard";
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
  // Solo las cuentas que de verdad pueden publicar. Mostrar las inactivas o de
  // prueba en la pantalla de publicar invita a elegir una que no envia nada.
  // Un mismo destino puede tener varias conexiones historicas. Gana la que
  // lleva el identificador real del proveedor (numerico o token de la API);
  // las que guardan una URL son registros antiguos hechos a mano.
  const activas = accounts.filter((account) => account.isActive && ["SIMULATION", "READY"].includes(socialConnectionState(account.platform)));
  // La seleccion vive en `lib/social/cuentas`, con pruebas: aqui estaba
  // escrita a mano y nadie podia comprobar que elegia la cuenta correcta.
  const publicables = cuentasCanonicasPorRed(activas).map((account) => ({
    id: account.id,
    platform: account.platform,
    displayName: account.displayName,
  }));
  const boardPosts = posts.map((item) => ({
    id: item.id,
    caption: item.caption,
    mediaUrl: item.mediaUrl,
    linkUrl: item.linkUrl,
    status: item.status,
    platform: item.account.platform,
    accountName: item.account.displayName,
    scheduledAt: item.scheduledAt?.toISOString() ?? null,
    error: item.errorMessage ?? item.error,
    providerPostUrl: item.providerPostUrl,
  }));
  const recurrentes = schedules.map((item) => ({
    id: item.id,
    name: item.name,
    caption: item.caption,
    weekday: item.weekday,
    localTime: item.localTime,
    isActive: item.isActive,
    nextRunAt: item.nextRunAt.toISOString(),
    platform: item.account.platform,
  }));

  return (
    <main className="container admin-shell">
      <AdminNav view={view} />
      <AdminPageHeader
        eyebrow="Contenido"
        title="Publicaciones"
        description="Crea, programa y revisa contenido para Facebook, Instagram y TikTok."
      />

      {view === "direccion" ? (
        <IntegrationStatusPanel technical={false} only={["facebook", "instagram", "tiktok"]} />
      ) : (
        <details className="panel social-advanced-tools">
          <summary>
            <span>
              <strong>Herramientas técnicas de canales</strong>
              <small>Conexiones, cuentas y diagnósticos. No es necesario abrirlas para publicar.</small>
            </span>
            <span aria-hidden="true">Ver herramientas</span>
          </summary>
          <div className="social-advanced-content">
            <IntegrationStatusPanel technical only={["facebook", "instagram", "tiktok", "whatsapp", "meta_ads"]} />
            <details className="technical-subtools">
              <summary>Administrar conexión de TikTok</summary>
              <TikTokPanel />
            </details>
            <RedesManager
              technicalOnly
              accounts={accounts.map((item) => ({ id: item.id, platform: item.platform, displayName: item.displayName, externalId: item.externalId, isActive: item.isActive, connectorState: socialConnectionState(item.platform), connectionStatus: item.connectionStatus, connectionCheckedAt: item.connectionCheckedAt?.toISOString() ?? null, connectionError: item.connectionError }))}
              posts={posts.map((item) => ({ id: item.id, caption: item.caption, mediaUrl: item.mediaUrl, linkUrl: item.linkUrl, status: item.status, account: `${item.account.platform} · ${item.account.displayName}`, scheduledAt: item.scheduledAt?.toISOString() ?? null, error: item.errorMessage ?? item.error, errorCode: item.errorCode, providerPostUrl: item.providerPostUrl, externalPostId: item.externalPostId }))}
              schedules={schedules.map((item) => ({ id: item.id, name: item.name, caption: item.caption, mediaUrl: item.mediaUrl, linkUrl: item.linkUrl, weekday: item.weekday, localTime: item.localTime, isActive: item.isActive, nextRunAt: item.nextRunAt.toISOString(), account: `${item.account.platform} · ${item.account.displayName}` }))}
            />
          </div>
        </details>
      )}

      <PublishComposer accounts={publicables} />
      <PostsBoard posts={boardPosts} recurrentes={recurrentes} />
    </main>
  );
}
