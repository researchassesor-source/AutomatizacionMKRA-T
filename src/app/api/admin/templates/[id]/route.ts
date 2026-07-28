import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

const schema = z.object({ isActive: z.boolean().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const template = await prisma.messageTemplate.update({ where: { id }, data: parsed.data }).catch(() => null);
  if (!template) return NextResponse.json({ error: "No se encontró la plantilla." }, { status: 404 });
  await writeAudit({ session: auth.session, action: "TEMPLATE_UPDATED", entityType: "MessageTemplate", entityId: id });
  return NextResponse.json({ ok: true });
}
