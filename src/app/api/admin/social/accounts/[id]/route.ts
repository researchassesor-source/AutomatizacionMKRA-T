import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { getAdapter } from "@/lib/social/orchestrator";

const schema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  externalId: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  if (parsed.data.isActive === true) {
    const current = await prisma.socialAccount.findUnique({ where: { id }, select: { platform: true } });
    if (!current) return NextResponse.json({ error: "No se encontró la cuenta." }, { status: 404 });
    if (!getAdapter(current.platform)) {
      return NextResponse.json({ error: "Esta red todavía no tiene un conector disponible." }, { status: 422 });
    }
  }
  const account = await prisma.socialAccount.update({ where: { id }, data: parsed.data }).catch(() => null);
  if (!account) return NextResponse.json({ error: "No se encontró la cuenta." }, { status: 404 });
  await writeAudit({ session: auth.session, action: "SOCIAL_ACCOUNT_UPDATED", entityType: "SocialAccount", entityId: id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  const dependencies = await prisma.socialPost.count({ where: { accountId: id } });
  if (dependencies > 0) {
    await prisma.socialAccount.update({ where: { id }, data: { isActive: false } });
    await writeAudit({ session: auth.session, action: "SOCIAL_ACCOUNT_DEACTIVATED", entityType: "SocialAccount", entityId: id });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await prisma.socialAccount.delete({ where: { id } }).catch(() => null);
  await writeAudit({ session: auth.session, action: "SOCIAL_ACCOUNT_DELETED", entityType: "SocialAccount", entityId: id });
  return NextResponse.json({ ok: true, deleted: true });
}
