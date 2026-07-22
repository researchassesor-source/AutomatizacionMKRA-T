import { prisma } from "@/lib/db";
import { AdminNav } from "../AdminNav";
import { RedesManager } from "./RedesManager";

export const dynamic = "force-dynamic";

export default async function AdminRedes() {
  const [accounts, posts] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.socialPost.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { account: true },
    }),
  ]);

  return (
    <main className="container admin-shell">
      <AdminNav active="/admin/redes" />
      <h1 style={{ marginTop: 0 }}>Redes sociales</h1>

      <RedesManager
        accounts={accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          displayName: a.displayName,
        }))}
        posts={posts.map((p) => ({
          id: p.id,
          caption: p.caption,
          status: p.status,
          account: `${p.account.platform} · ${p.account.displayName}`,
          scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null,
          error: p.error,
        }))}
      />
    </main>
  );
}
