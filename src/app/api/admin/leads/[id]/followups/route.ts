import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { COMERCIAL } from "@/lib/auth/roles";

const schema = z.object({
  type: z.enum(["LLAMADA", "WHATSAPP", "CORREO", "REUNION", "RECORDATORIO", "OTRO"]),
  dueAt: z.string().datetime(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  assignedToId: z.string().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, COMERCIAL);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos de seguimiento no válidos." }, { status: 422 });
  const { id } = await params;
  const followUp = await prisma.followUp.create({
    data: {
      leadId: id,
      type: parsed.data.type,
      dueAt: new Date(parsed.data.dueAt),
      notes: parsed.data.notes || null,
      assignedToId: parsed.data.assignedToId ?? auth.session?.userId ?? null,
    },
  }).catch(() => null);
  if (!followUp) return NextResponse.json({ error: "No se pudo programar el seguimiento." }, { status: 400 });
  await writeAudit({ session: auth.session, action: "FOLLOW_UP_CREATED", entityType: "FollowUp", entityId: followUp.id });
  return NextResponse.json({ ok: true, followUp }, { status: 201 });
}
