import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

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
});

// Mueve un lead de etapa en el pipeline (ej. OPORTUNIDAD -> CLIENTE / PERDIDO).
export async function POST(request: Request) {
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
    data: { stage: parsed.data.stage },
  });

  await prisma.leadEvent.create({
    data: {
      leadId: parsed.data.leadId,
      type: "stage_change",
      payload: { from: lead.stage, to: parsed.data.stage },
    },
  });

  return NextResponse.json({ ok: true });
}
