import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  status: z.enum(["PENDIENTE", "COMPLETADO", "CANCELADO", "VENCIDO"]).optional(),
  type: z.enum(["LLAMADA", "WHATSAPP", "CORREO", "REUNION", "RECORDATORIO", "OTRO"]).optional(),
  dueAt: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  assignedToId: z.string().max(100).nullable().optional(),
  confirm: z.boolean().optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: "No hay cambios para guardar.",
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "VENTAS"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  if (parsed.data.confirm !== true) return NextResponse.json({ error: "Debes confirmar la actualización del seguimiento." }, { status: 422 });
  const { id } = await params;
  const followUp = await prisma.followUp.update({
    where: { id },
    data: {
      status: parsed.data.status,
      completedAt: parsed.data.status === "COMPLETADO" ? new Date() : parsed.data.status ? null : undefined,
      type: parsed.data.type,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
      notes: parsed.data.notes,
      assignedToId: parsed.data.assignedToId,
    },
  }).catch(() => null);
  if (!followUp) return NextResponse.json({ error: "No se encontró el seguimiento." }, { status: 404 });
  await writeAudit({
    session: auth.session,
    action: parsed.data.dueAt ? "FOLLOW_UP_RESCHEDULED" : "FOLLOW_UP_UPDATED",
    entityType: "FollowUp",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
