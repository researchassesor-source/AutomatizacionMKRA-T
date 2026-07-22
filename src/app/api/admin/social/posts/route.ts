import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({
  accountId: z.string().min(1),
  caption: z.string().min(1, "El texto no puede estar vacio"),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  linkUrl: z.string().url().optional().or(z.literal("")),
  // ISO string; si viene, el post queda PROGRAMADO, si no, BORRADOR
  scheduledAt: z.string().datetime().optional().or(z.literal("")),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "datos invalidos" },
      { status: 422 },
    );
  }
  const d = parsed.data;

  const account = await prisma.socialAccount.findUnique({
    where: { id: d.accountId },
  });
  if (!account) {
    return NextResponse.json({ error: "cuenta no encontrada" }, { status: 404 });
  }

  const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
  const post = await prisma.socialPost.create({
    data: {
      accountId: d.accountId,
      caption: d.caption,
      mediaUrl: d.mediaUrl || null,
      linkUrl: d.linkUrl || null,
      scheduledAt,
      status: scheduledAt ? "PROGRAMADO" : "BORRADOR",
    },
  });

  return NextResponse.json({ ok: true, postId: post.id }, { status: 201 });
}
