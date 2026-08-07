import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { GESTION } from "@/lib/auth/roles";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(256),
  role: z.enum(["ADMIN", "DIRECCION", "MARKETING", "VENTAS", "LECTURA"]),
});

export async function POST(request: Request) {
  const auth = await requireRole(request, GESTION);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  try {
    const user = await prisma.adminUser.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash: await hashPassword(parsed.data.password),
        role: parsed.data.role,
      },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    await writeAudit({ session: auth.session, action: "ADMIN_USER_CREATED", entityType: "AdminUser", entityId: user.id });
    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo crear el usuario. El correo podría estar registrado." }, { status: 409 });
  }
}
