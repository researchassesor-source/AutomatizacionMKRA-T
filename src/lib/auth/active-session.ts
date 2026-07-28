import { prisma } from "@/lib/db";
import { isLegacyAdminEnabled } from "@/lib/admin-auth";
import type { AdminSession } from "./session";

export async function resolveActiveAdminSession(
  session: AdminSession | null,
): Promise<AdminSession | null> {
  if (!session) return null;

  if (session.legacy) {
    return session.userId === null && isLegacyAdminEnabled() ? session : null;
  }

  if (!session.userId) return null;
  const user = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
  if (!user?.isActive) return null;

  return {
    ...session,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    legacy: false,
  };
}
