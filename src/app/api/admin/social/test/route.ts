import { NextResponse } from "next/server";
import { isSocialSimulation, socialConnectionErrorState, verifyPlatformConnection } from "@/lib/social/orchestrator";
import type { Platform } from "@/lib/social/types";
import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PLATFORMS: Platform[] = [
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "YOUTUBE",
  "LINKEDIN",
];

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  let platform: string | undefined;
  try {
    platform = (await request.json())?.platform;
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!platform || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "plataforma invalida" }, { status: 422 });
  }

  // TikTok no se comprueba desde aquí: su estado lo determina la conexión OAuth
  // y TIKTOK_MODE, no SOCIAL_MODE. Sobrescribirlo con "SIMULATION" borraba una
  // conexión real y dejaba la cuenta inutilizable en el panel de TikTok.
  if (platform === "TIKTOK") {
    return NextResponse.json({
      ok: false,
      error: "El estado de TikTok se gestiona desde su propio panel, con la conexión autorizada por la persona usuaria.",
    }, { status: 409 });
  }

  const result = await verifyPlatformConnection(platform as Platform);
  const simulation = isSocialSimulation();
  const connectionError = "error" in result ? result.error : undefined;
  await prisma.socialAccount.updateMany({
    where: { platform: platform as Platform },
    data: {
      connectionStatus: simulation ? "SIMULATION" : result.ok ? "READY" : socialConnectionErrorState(connectionError),
      connectionCheckedAt: new Date(),
      connectionError: result.ok ? null : connectionError?.slice(0, 500),
    },
  });
  await writeAudit({ session: auth.session, action: "SOCIAL_CONNECTION_CHECKED", entityType: "SocialAccount", result: result.ok ? "SUCCESS" : "FAILURE", metadata: { platform, simulation, state: simulation ? "SIMULATION" : result.ok ? "READY" : socialConnectionErrorState(connectionError) } });
  return NextResponse.json(result);
}
