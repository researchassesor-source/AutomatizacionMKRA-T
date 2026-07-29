import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

const schema = z.object({ content: z.string().trim().min(2).max(4000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "VENTAS"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Escribe una nota válida." }, { status: 422 });
  const { id } = await params;
  if (!(await prisma.lead.findUnique({ where: { id }, select: { id: true } }))) {
    return NextResponse.json({ error: "No se encontró el contacto." }, { status: 404 });
  }
  const note = await prisma.leadNote.create({
    data: { leadId: id, authorId: auth.session?.userId ?? null, content: parsed.data.content },
  });
  await writeAudit({ session: auth.session, action: "LEAD_NOTE_CREATED", entityType: "Lead", entityId: id });
  return NextResponse.json({ ok: true, note }, { status: 201 });
}
