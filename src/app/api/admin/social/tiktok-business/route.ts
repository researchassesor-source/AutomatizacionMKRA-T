import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO, TECNICO } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { describeConnection, disconnectAccount } from "@/lib/social/tiktok-business/account";
import { describeTikTokBusinessConfig, resolveTikTokBusinessConfig } from "@/lib/social/tiktok-business/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const configuration = describeTikTokBusinessConfig();
  // El código puede desplegarse antes de aplicar la migración. Mientras la
  // integración siga disabled no consulta la tabla nueva ni realiza I/O externo.
  if (configuration.connectionReason) return NextResponse.json({ configuration, accounts: [] });
  const connections = await prisma.tikTokBusinessConnection.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    configuration,
    accounts: connections.map(describeConnection),
  });
}

export async function DELETE(request: Request) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;
  const parsed = z.object({ accountId: z.string().trim().min(1), confirm: z.literal(true) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Debes confirmar la desconexión." }, { status: 422 });
  const result = await disconnectAccount(parsed.data.accountId, resolveTikTokBusinessConfig(), auth.session?.email ?? "admin");
  if (!result.ok) return NextResponse.json({ error: "No se encontró la conexión TikTok Business." }, { status: 404 });
  return NextResponse.json({ ok: true, revokedAtProvider: result.revoked, message: "Cuenta desconectada. El historial se conserva." });
}
