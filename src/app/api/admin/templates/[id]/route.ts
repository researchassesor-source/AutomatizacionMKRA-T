import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { TEMPLATE_VARIABLES } from "@/lib/nurture/engine";
import { CONTENIDO } from "@/lib/auth/roles";

const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(2).max(10000).optional(),
  category: z.string().trim().max(80).nullable().optional(),
  isActive: z.boolean().optional(),
  confirm: z.literal(true),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const current = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "No se encontró la plantilla." }, { status: 404 });
  const subject = parsed.data.subject === undefined ? current.subject : parsed.data.subject;
  const body = parsed.data.body ?? current.body;
  if (current.channel === "EMAIL" && !subject) return NextResponse.json({ error: "El asunto es obligatorio para correo." }, { status: 422 });
  for (const match of `${subject ?? ""} ${body}`.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!TEMPLATE_VARIABLES.includes(match[1] as (typeof TEMPLATE_VARIABLES)[number])) {
      return NextResponse.json({ error: `Variable no permitida: {{${match[1]}}}` }, { status: 422 });
    }
  }
  const { confirm: _confirm, ...changes } = parsed.data;
  const template = await prisma.messageTemplate.update({ where: { id }, data: changes }).catch(() => null);
  if (!template) return NextResponse.json({ error: "No se encontró la plantilla." }, { status: 404 });
  await writeAudit({ session: auth.session, action: "TEMPLATE_UPDATED", entityType: "MessageTemplate", entityId: id });
  return NextResponse.json({ ok: true });
}
