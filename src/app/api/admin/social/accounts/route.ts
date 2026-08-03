import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { getAdapter, socialConnectionState } from "@/lib/social/orchestrator";

export const dynamic = "force-dynamic";

const schema = z.object({
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "LINKEDIN"]),
  displayName: z.string().trim().min(1).max(120),
  externalId: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "datos invalidos" },
      { status: 422 },
    );
  }
  if (!getAdapter(parsed.data.platform)) {
    return NextResponse.json({ error: "Esta red todavía no tiene un conector disponible." }, { status: 422 });
  }

  const account = await prisma.socialAccount.upsert({
    where: {
      platform_externalId: {
        platform: parsed.data.platform,
        externalId: parsed.data.externalId ?? "",
      },
    },
    update: { displayName: parsed.data.displayName, isActive: true, connectionStatus: socialConnectionState(parsed.data.platform) === "SIMULATION" ? "SIMULATION" : "UNKNOWN" },
    create: {
      platform: parsed.data.platform,
      displayName: parsed.data.displayName,
      externalId: parsed.data.externalId ?? "",
      connectionStatus: socialConnectionState(parsed.data.platform) === "SIMULATION" ? "SIMULATION" : "UNKNOWN",
    },
  });

  await writeAudit({ session: auth.session, action: "SOCIAL_ACCOUNT_SAVED", entityType: "SocialAccount", entityId: account.id });

  return NextResponse.json({ ok: true, accountId: account.id }, { status: 201 });
}
