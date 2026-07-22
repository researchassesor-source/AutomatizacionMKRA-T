import { NextResponse } from "next/server";
import { ADMIN_COOKIE, checkPassword, isAdminEnabled, sessionToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAdminEnabled()) {
    return NextResponse.json(
      { error: "Panel deshabilitado: define ADMIN_PASSWORD en el entorno" },
      { status: 503 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Contrasena incorrecta" }, { status: 401 });
  }

  const token = (await sessionToken())!;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 horas
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
