import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { describeMetaConfig, resolveMetaConfig } from "@/lib/social/meta-config";
import { isSocialSimulation, socialConnectionErrorState, verifyPlatformConnection } from "@/lib/social/orchestrator";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Registra en el CRM la página de Facebook y la cuenta de Instagram definidas
 * en las variables de entorno, y comprueba su estado real.
 *
 * Las credenciales nunca se guardan en la base: `SocialAccount` solo conserva
 * el identificador público y el resultado de la comprobación.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = z.object({ confirm: z.literal(true) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Debes confirmar la sincronización de cuentas." }, { status: 422 });

  const config = resolveMetaConfig();
  const summary = describeMetaConfig(config);
  if (!config.accessToken) {
    return NextResponse.json({ error: "Falta el token del usuario del sistema de Meta (META_SYSTEM_USER_TOKEN).", configuration: summary }, { status: 422 });
  }

  const targets = [
    { platform: "FACEBOOK" as const, externalId: config.pageId, fallbackName: "Research Assessor & Training" },
    { platform: "INSTAGRAM" as const, externalId: config.igUserId, fallbackName: "Instagram de R.A. Training" },
  ].filter((target): target is { platform: "FACEBOOK" | "INSTAGRAM"; externalId: string; fallbackName: string } => Boolean(target.externalId));

  if (targets.length === 0) {
    return NextResponse.json({ error: "Faltan META_PAGE_ID y META_INSTAGRAM_ACCOUNT_ID.", configuration: summary }, { status: 422 });
  }

  const simulation = isSocialSimulation();
  const results = [];
  for (const target of targets) {
    const verification = await verifyPlatformConnection(target.platform);
    const verificationError = "error" in verification ? verification.error : undefined;
    const displayName = ("name" in verification && verification.name) || target.fallbackName;
    const connectionStatus = simulation
      ? ("SIMULATION" as const)
      : verification.ok
        ? ("READY" as const)
        : socialConnectionErrorState(verificationError);

    const account = await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: target.platform, externalId: target.externalId } },
      create: {
        platform: target.platform,
        displayName,
        externalId: target.externalId,
        isActive: true,
        connectionStatus,
        connectionCheckedAt: new Date(),
        connectionError: verification.ok ? null : verificationError?.slice(0, 500) ?? null,
      },
      update: {
        displayName,
        isActive: true,
        connectionStatus,
        connectionCheckedAt: new Date(),
        connectionError: verification.ok ? null : verificationError?.slice(0, 500) ?? null,
      },
    });
    results.push({
      platform: target.platform,
      accountId: account.id,
      displayName: account.displayName,
      externalId: account.externalId,
      state: connectionStatus,
      error: verification.ok ? null : verificationError ?? null,
    });
  }

  await writeAudit({
    session: auth.session,
    action: "SOCIAL_ACCOUNTS_SYNCED",
    entityType: "SocialAccount",
    result: results.every((item) => item.error === null) ? "SUCCESS" : "FAILURE",
    metadata: { simulation, graphVersion: summary.graphVersion, platforms: results.map((item) => ({ platform: item.platform, state: item.state })) },
  });
  return NextResponse.json({ ok: true, simulation, configuration: summary, accounts: results });
}
