import { NextResponse } from "next/server";
import { rescoreAll } from "@/lib/scoring";
import { requireRole } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

// Recalcula el score de todos los leads (boton del panel o cron).
export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "VENTAS"]);
  if (auth.error) return auth.error;
  const summary = await rescoreAll();
  return NextResponse.json(summary);
}
