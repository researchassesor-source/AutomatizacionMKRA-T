import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { describeConnection, disconnectAccount } from "@/lib/social/tiktok/account";
import { describeTikTokConfig, resolveTikTokConfig } from "@/lib/social/tiktok/config";

export const dynamic = "force-dynamic";

const accountSelect = {
  id: true,
  openId: true,
  nickname: true,
  displayName: true,
  avatarUrl: true,
  grantedScopes: true,
  connectionStatus: true,
  connectedAt: true,
  refreshedAt: true,
  accessTokenExpiresAt: true,
  refreshTokenExpiresAt: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  isActive: true,
} as const;

/** Estado de la integración. La respuesta nunca incluye tokens ni credenciales. */
export async function GET(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const accounts = await prisma.socialAccount.findMany({
    where: { platform: "TIKTOK" },
    select: accountSelect,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    configuration: describeTikTokConfig(),
    accounts: accounts.map(describeConnection),
  });
}

/**
 * Desconexión: revoca en TikTok y borra el material cifrado. Conserva el
 * historial de publicaciones, que es evidencia.
 */
export async function DELETE(request: Request) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  const parsed = z.object({ accountId: z.string().trim().min(1), confirm: z.literal(true) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Debes confirmar explícitamente la desconexión." }, { status: 422 });
  }
  const config = resolveTikTokConfig();
  const result = await disconnectAccount(parsed.data.accountId, config, auth.session?.email ?? "admin");
  if (!result.ok) return NextResponse.json({ error: "No se encontró la cuenta de TikTok." }, { status: 404 });
  return NextResponse.json({
    ok: true,
    revokedAtProvider: result.revoked,
    message: result.revoked
      ? "Cuenta desconectada y acceso revocado en TikTok."
      : "Cuenta desconectada localmente. TikTok no confirmó la revocación; revisa los accesos desde tu cuenta.",
  });
}
