import { NextResponse } from "next/server";
import { z } from "zod";
import { rescoreAll } from "@/lib/scoring";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { COMERCIAL } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

// Recalcula el score de todos los leads (boton del panel o cron).
export async function POST(request: Request) {
  const auth = await requireRole(request, COMERCIAL);
  if (auth.error) return auth.error;
  const parsed = z.object({ confirm: z.literal(true) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Debes confirmar el recálculo global." }, { status: 422 });
  const summary = await rescoreAll();
  await writeAudit({ session: auth.session, action: "LEAD_SCORES_RECOMPUTED", entityType: "Lead", metadata: summary });
  return NextResponse.json(summary);
}
