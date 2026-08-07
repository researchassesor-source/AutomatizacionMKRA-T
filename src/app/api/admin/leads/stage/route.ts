import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { COMERCIAL } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const schema = z.object({
  leadId: z.string().min(1),
  stage: z.enum([
    "NUEVO",
    "INSCRITO",
    "EN_CURSO",
    "CERTIFICADO",
    "OPORTUNIDAD",
    "CLIENTE",
    "PERDIDO",
  ]),
  lostReason: z.string().trim().min(3).max(500).optional(),
  confirm: z.boolean().optional(),
}).superRefine((data, context) => {
  if (["CLIENTE", "PERDIDO"].includes(data.stage) && data.confirm !== true) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Debes confirmar el cierre comercial." });
  }
  if (data.stage === "PERDIDO" && !data.lostReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["lostReason"], message: "Indica el motivo de pérdida." });
  }
});

// Mueve un lead de etapa en el pipeline (ej. OPORTUNIDAD -> CLIENTE / PERDIDO).
export async function POST(request: Request) {
  const auth = await requireRole(request, COMERCIAL);
  if (auth.error) return auth.error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "datos invalidos" }, { status: 422 });
  }

  const lead = await prisma.lead.findUnique({ where: { id: parsed.data.leadId } });
  if (!lead) {
    return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });
  }

  await prisma.lead.update({
    where: { id: parsed.data.leadId },
    data: {
      stage: parsed.data.stage,
      lostReason: parsed.data.stage === "PERDIDO" ? parsed.data.lostReason : null,
    },
  });

  await prisma.leadEvent.create({
    data: {
      leadId: parsed.data.leadId,
      type: "stage_change",
      payload: { from: lead.stage, to: parsed.data.stage, lostReason: parsed.data.lostReason ?? null },
    },
  });

  await writeAudit({ session: auth.session, action: "LEAD_STAGE_CHANGED", entityType: "Lead", entityId: parsed.data.leadId, metadata: { from: lead.stage, to: parsed.data.stage, lostReason: parsed.data.lostReason } });

  return NextResponse.json({ ok: true });
}
