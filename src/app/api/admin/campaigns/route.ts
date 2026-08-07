import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { CONTENIDO } from "@/lib/auth/roles";

const campaignSchema = z.object({
  name: z.string().trim().min(3).max(120),
  code: z.string().trim().toLowerCase().min(3).max(80).regex(/^[a-z0-9][a-z0-9_-]+$/),
  courseId: z.string().trim().nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("DRAFT"),
  source: z.string().trim().max(120).nullable().optional(),
  utmSource: z.string().trim().max(120).nullable().optional(),
  utmMedium: z.string().trim().max(120).nullable().optional(),
  utmCampaign: z.string().trim().max(160).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
}).refine((value) => !value.startsAt || !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt), { message: "La fecha final debe ser posterior a la inicial." });

export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = campaignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  if (parsed.data.courseId && !await prisma.course.findUnique({ where: { id: parsed.data.courseId }, select: { id: true } })) {
    return NextResponse.json({ error: "El curso seleccionado no existe." }, { status: 422 });
  }
  try {
    const campaign = await prisma.campaign.create({
      data: {
        ...parsed.data,
        courseId: parsed.data.courseId || null,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
      },
    });
    await writeAudit({ session: auth.session, action: "CAMPAIGN_CREATED", entityType: "Campaign", entityId: campaign.id, metadata: { status: campaign.status, courseId: campaign.courseId } });
    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) return NextResponse.json({ error: "Ya existe una campaña con ese código." }, { status: 409 });
    throw error;
  }
}
