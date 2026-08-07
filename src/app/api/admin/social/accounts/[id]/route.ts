import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { getAdapter } from "@/lib/social/orchestrator";
import { CONTENIDO, TECNICO } from "@/lib/auth/roles";

const schema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  externalId: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 422 });
  if (parsed.data.isActive === false && parsed.data.confirm !== true) {
    return NextResponse.json({ error: "Debes confirmar la desactivación de la cuenta." }, { status: 422 });
  }
  const { id } = await params;
  if (parsed.data.isActive === true) {
    const current = await prisma.socialAccount.findUnique({ where: { id }, select: { platform: true } });
    if (!current) return NextResponse.json({ error: "No se encontró la cuenta." }, { status: 404 });
    if (!getAdapter(current.platform)) {
      return NextResponse.json({ error: "Esta red todavía no tiene un conector disponible." }, { status: 422 });
    }
  }
  const { confirm: _confirm, ...changes } = parsed.data;
  const account = await prisma.socialAccount.update({ where: { id }, data: changes }).catch(() => null);
  if (!account) return NextResponse.json({ error: "No se encontró la cuenta." }, { status: 404 });
  await writeAudit({ session: auth.session, action: "SOCIAL_ACCOUNT_UPDATED", entityType: "SocialAccount", entityId: id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;
  const confirmation = z.object({ confirm: z.literal(true) }).safeParse(await request.json().catch(() => null));
  if (!confirmation.success) return NextResponse.json({ error: "Debes confirmar la desactivación de la cuenta." }, { status: 422 });
  const { id } = await params;
  const account = await prisma.socialAccount.findUnique({ where: { id }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "No se encontró la cuenta." }, { status: 404 });
  const [posts, schedules] = await Promise.all([
    prisma.socialPost.count({ where: { accountId: id } }),
    prisma.socialSchedule.count({ where: { accountId: id } }),
  ]);
  await prisma.socialAccount.update({ where: { id }, data: { isActive: false } });
  await writeAudit({
    session: auth.session,
    action: "SOCIAL_ACCOUNT_DEACTIVATED",
    entityType: "SocialAccount",
    entityId: id,
    metadata: { posts, schedules, preservedHistory: true },
  });
  return NextResponse.json({ ok: true, deactivated: true, preservedHistory: true });
}
