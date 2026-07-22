import { NextResponse } from "next/server";
import { rescoreAll } from "@/lib/scoring";

export const dynamic = "force-dynamic";

// Recalcula el score de todos los leads (boton del panel o cron).
export async function POST() {
  const summary = await rescoreAll();
  return NextResponse.json(summary);
}
