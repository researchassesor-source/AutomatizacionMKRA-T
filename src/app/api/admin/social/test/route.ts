import { NextResponse } from "next/server";
import { verifyPlatformConnection } from "@/lib/social/orchestrator";
import type { Platform } from "@/lib/social/types";

export const dynamic = "force-dynamic";

const PLATFORMS: Platform[] = [
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "YOUTUBE",
  "LINKEDIN",
];

export async function POST(request: Request) {
  let platform: string | undefined;
  try {
    platform = (await request.json())?.platform;
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!platform || !PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: "plataforma invalida" }, { status: 422 });
  }

  const result = await verifyPlatformConnection(platform as Platform);
  return NextResponse.json(result);
}
