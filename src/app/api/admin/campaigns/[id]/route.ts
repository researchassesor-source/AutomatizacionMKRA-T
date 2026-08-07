import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { CONTENIDO, GESTION } from "@/lib/auth/roles";

const updateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
  source: z.string().trim().max(120).nullable().optional(),
  utmSource: z.string().trim().max(120).nullable().optional(),
  utmMedium: z.string().trim().max(120).nullable().optional(),
  utmCampaign: z.string().trim().max(160).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  confirm: z.literal(true),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos o confirmación no válidos." }, { status: 422 });
  const { id } = await params;
  const { confirm: _confirm, startsAt, endsAt, ...data } = parsed.data;
  const campaign = await prisma.campaign.update({
    where: { id },
    data: { ...data, startsAt: startsAt === undefined ? undefined : startsAt ? new Date(startsAt) : null, endsAt: endsAt === undefined ? undefined : endsAt ? new Date(endsAt) : null },
  }).catch(() => null);
  if (!campaign) return NextResponse.json({ error: "No se encontró la campaña." }, { status: 404 });
  await writeAudit({ session: auth.session, action: "CAMPAIGN_UPDATED", entityType: "Campaign", entityId: id, metadata: { status: campaign.status } });
  return NextResponse.json({ ok: true, campaign });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, GESTION);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  if (body?.confirm !== "ARCHIVE_CAMPAIGN") return NextResponse.json({ error: "Falta la confirmación requerida." }, { status: 422 });
  const { id } = await params;
  const campaign = await prisma.campaign.update({ where: { id }, data: { status: "ARCHIVED" } }).catch(() => null);
  if (!campaign) return NextResponse.json({ error: "No se encontró la campaña." }, { status: 404 });
  await writeAudit({ session: auth.session, action: "CAMPAIGN_ARCHIVED", entityType: "Campaign", entityId: id });
  return NextResponse.json({ ok: true, archived: true });
}
