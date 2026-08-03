import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canUseLegacyAdminLogin } from "@/lib/admin-auth";
import { verifyPassword } from "@/lib/auth/password";
import {
  ADMIN_COOKIE,
  createSessionToken,
  authIsConfigured,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/session";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { PayloadTooLargeError, readJsonBody } from "@/lib/http";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const limit = await checkRateLimit(requestKey(request, "admin-login"), {
    limit: 7,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "No se pudo iniciar sesión. Inténtalo más tarde." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let parsed: z.infer<typeof loginSchema>;
  try {
    parsed = loginSchema.parse(await readJsonBody(request, 4_096));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
    }
    return NextResponse.json({ error: "Datos de acceso no válidos." }, { status: 400 });
  }

  const normalizedEmail = parsed.email?.toLowerCase() || "";
  if (!authIsConfigured()) {
    return NextResponse.json({ error: "El acceso administrativo no está configurado." }, { status: 503 });
  }
  const user = normalizedEmail
    ? await prisma.adminUser.findUnique({ where: { email: normalizedEmail } })
    : null;
  const passwordMatches = user ? await verifyPassword(parsed.password, user.passwordHash) : false;

  if (user?.isActive && passwordMatches) {
    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      legacy: false,
    });
    if (!token) {
      return NextResponse.json({ error: "Acceso administrativo no configurado." }, { status: 503 });
    }
    await writeAudit({
      actorEmail: user.email,
      action: "AUTH_LOGIN",
      entityType: "AdminUser",
      entityId: user.id,
    });
    const response = NextResponse.json({ ok: true, role: user.role });
    response.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  }

  if (user && !user.isActive && passwordMatches) {
    await writeAudit({
      actorEmail: user.email,
      action: "AUTH_LOGIN_DISABLED",
      entityType: "AdminUser",
      entityId: user.id,
      result: "FAILURE",
    });
    return NextResponse.json(
      { error: "Esta cuenta no tiene acceso. Contacta a un administrador." },
      { status: 403 },
    );
  }

  // Compatibilidad temporal: permite la contraseña compartida configurada en
  // el entorno local. Las nuevas instalaciones deben crear AdminUser.
  if (canUseLegacyAdminLogin(normalizedEmail, parsed.password)) {
    const token = await createSessionToken({
      userId: null,
      email: "legacy-local",
      name: "Administrador local",
      role: "ADMIN",
      legacy: true,
    });
    if (!token) {
      return NextResponse.json({ error: "Acceso administrativo no configurado." }, { status: 503 });
    }
    const response = NextResponse.json({ ok: true, role: "ADMIN", legacy: true });
    response.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === "production",
    });
    await writeAudit({
      actorEmail: "legacy-local",
      action: "AUTH_LOGIN_LEGACY",
      entityType: "Session",
    });
    return response;
  }

  await writeAudit({
    actorEmail: normalizedEmail || null,
    action: "AUTH_LOGIN",
    entityType: "AdminUser",
    result: "FAILURE",
  });
  return NextResponse.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
}
