import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { isSocialAccountUsable } from "@/lib/social/orchestrator";
import { componerCaption, esUrlDestinoValida } from "@/lib/social/cta";
import { motivoNoPublicable } from "@/lib/social/cuentas";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const schema = z.object({
  accountId: z.string().min(1),
  caption: z.string().trim().min(1, "El texto no puede estar vacío").max(10000),
  mediaUrl: z.string().url().max(1000).optional().or(z.literal("")),
  // URL de destino. Se exige HTTPS: Facebook degrada el contenido mixto y un
  // enlace http en una publicacion de la empresa es una mala señal.
  linkUrl: z
    .string()
    .max(1000)
    .refine((valor) => !valor || esUrlDestinoValida(valor), "La URL de destino debe empezar por https:// y apuntar a un dominio público.")
    .optional()
    .or(z.literal("")),
  /** Llamada a la accion propia de Instagram. Vacio = no añadir nada. */
  instagramCta: z.string().trim().max(300).optional(),
  // ISO string; si viene, el post queda PROGRAMADO, si no, BORRADOR
  scheduledAt: z.string().datetime().optional().or(z.literal("")),
});

export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
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
  if (!account.isActive || !isSocialAccountUsable(account.platform)) {
    return NextResponse.json({ error: "La cuenta no está disponible para publicar en este entorno." }, { status: 422 });
  }
  // Defensa en el servidor: aunque el panel ya solo ofrece la cuenta buena, una
  // cuenta antigua sin identificador real publicaria en la pagina de la
  // variable de entorno en lugar de en la que dice su nombre.
  const motivo = motivoNoPublicable(account);
  if (motivo) {
    return NextResponse.json({ error: motivo }, { status: 422 });
  }

  const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
  /**
   * El caption se compone aqui, no al publicar.
   *
   * Asi el registro guarda exactamente el texto que saldra, y la vista previa
   * puede enseñar el mismo. Componerlo en el adaptador significaba que nadie
   * podia ver el resultado final hasta despues de publicarlo.
   */
  const captionFinal = componerCaption({
    plataforma: account.platform,
    textoBase: d.caption,
    urlDestino: d.linkUrl || null,
    ctaInstagram: d.instagramCta ?? null,
  });

  const post = await prisma.socialPost.create({
    data: {
      accountId: d.accountId,
      caption: captionFinal,
      mediaUrl: d.mediaUrl || null,
      linkUrl: d.linkUrl || null,
      scheduledAt,
      status: scheduledAt ? "PROGRAMADO" : "BORRADOR",
    },
  });

  await writeAudit({ session: auth.session, action: "SOCIAL_POST_CREATED", entityType: "SocialPost", entityId: post.id });

  return NextResponse.json({ ok: true, postId: post.id }, { status: 201 });
}
