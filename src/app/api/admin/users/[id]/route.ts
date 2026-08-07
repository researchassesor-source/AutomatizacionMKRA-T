import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { removesActiveAdministrator, requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { GESTION } from "@/lib/auth/roles";

const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["ADMIN", "MARKETING", "VENTAS", "LECTURA"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(256).optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: "No hay cambios para guardar.",
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, GESTION);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  if (id === auth.session?.userId && parsed.data.isActive === false) {
    return NextResponse.json({ error: "No puedes desactivar tu propia cuenta." }, { status: 409 });
  }

  const passwordHash = parsed.data.password ? await hashPassword(parsed.data.password) : undefined;
  let outcome: "updated" | "missing" | "last-admin" = "missing";
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const current = await tx.adminUser.findUnique({ where: { id } });
      if (!current) return "missing" as const;
      const removesActiveAdmin = removesActiveAdministrator(current, parsed.data);
      if (removesActiveAdmin) {
        const activeAdmins = await tx.adminUser.count({ where: { role: "ADMIN", isActive: true } });
        if (activeAdmins <= 1) return "last-admin" as const;
      }
      await tx.adminUser.update({
        where: { id },
        data: {
          name: parsed.data.name,
          role: parsed.data.role,
          isActive: parsed.data.isActive,
          passwordHash,
        },
      });
      return "updated" as const;
    }, { isolationLevel: "Serializable" });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar el usuario." }, { status: 409 });
  }
  if (outcome === "missing") return NextResponse.json({ error: "No se encontró el usuario." }, { status: 404 });
  if (outcome === "last-admin") {
    return NextResponse.json({ error: "Debe permanecer al menos un administrador activo." }, { status: 409 });
  }
  await writeAudit({ session: auth.session, action: "ADMIN_USER_UPDATED", entityType: "AdminUser", entityId: id });
  return NextResponse.json({ ok: true });
}
