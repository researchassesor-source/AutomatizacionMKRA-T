import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { UserManager } from "./UserManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await currentAdminSession();
  if (session?.role !== "ADMIN") return <main className="container admin-shell"><AdminNav /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para administrar usuarios." /></main>;
  const users = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
  return <main className="container admin-shell"><AdminNav /><AdminPageHeader eyebrow="Acceso y permisos" title="Usuarios administrativos" description="Administra perfiles, roles y disponibilidad de acceso al panel." /><UserManager users={users.map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, lastLoginAt: user.lastLoginAt?.toISOString() ?? null }))} /></main>;
}
