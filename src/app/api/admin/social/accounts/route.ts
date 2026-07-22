import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({
  platform: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "LINKEDIN"]),
  displayName: z.string().min(1),
  externalId: z.string().optional(),
});

export async function POST(request: Request) {
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

  const account = await prisma.socialAccount.upsert({
    where: {
      platform_externalId: {
        platform: parsed.data.platform,
        externalId: parsed.data.externalId ?? "",
      },
    },
    update: { displayName: parsed.data.displayName, isActive: true },
    create: {
      platform: parsed.data.platform,
      displayName: parsed.data.displayName,
      externalId: parsed.data.externalId ?? "",
    },
  });

  return NextResponse.json({ ok: true, accountId: account.id }, { status: 201 });
}
