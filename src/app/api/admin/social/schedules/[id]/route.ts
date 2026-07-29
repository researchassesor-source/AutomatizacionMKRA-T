import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { nextGuayaquilOccurrence } from "@/lib/social/orchestrator";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  action: z.enum(["update", "pause", "resume", "archive"]),
  confirm: z.literal(true),
  name: z.string().trim().min(2).max(120).optional(),
  caption: z.string().trim().min(1).max(10000).optional(),
  mediaUrl: z.union([z.literal(""), z.string().url()]).optional(),
  linkUrl: z.union([z.literal(""), z.string().url()]).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Recurrencia no válida." }, { status: 422 });
  const { id } = await params;
  const current = await prisma.socialSchedule.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "No se encontró la recurrencia." }, { status: 404 });

  const weekday = parsed.data.weekday ?? current.weekday;
  const localTime = parsed.data.localTime ?? current.localTime;
  const isActive = parsed.data.action === "resume" ? true : ["pause", "archive"].includes(parsed.data.action) ? false : current.isActive;
  const schedule = await prisma.socialSchedule.update({
    where: { id },
    data: {
      name: parsed.data.name,
      caption: parsed.data.caption,
      mediaUrl: parsed.data.mediaUrl === undefined ? undefined : parsed.data.mediaUrl || null,
      linkUrl: parsed.data.linkUrl === undefined ? undefined : parsed.data.linkUrl || null,
      weekday: parsed.data.weekday,
      localTime: parsed.data.localTime,
      isActive,
      nextRunAt: isActive && (parsed.data.action === "resume" || parsed.data.weekday !== undefined || parsed.data.localTime !== undefined)
        ? nextGuayaquilOccurrence(weekday, localTime)
        : undefined,
    },
  });
  await writeAudit({
    session: auth.session,
    action: `SOCIAL_SCHEDULE_${parsed.data.action.toUpperCase()}`,
    entityType: "SocialSchedule",
    entityId: id,
    metadata: { isActive: schedule.isActive, weekday: schedule.weekday, localTime: schedule.localTime },
  });
  return NextResponse.json({ ok: true, schedule });
}
