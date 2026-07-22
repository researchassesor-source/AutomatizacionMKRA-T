import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, sessionToken } from "@/lib/admin-auth";

// Protege el panel (/admin) y su API (/api/admin). El login queda excluido.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/admin/login" || pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/admin");
  const token = await sessionToken();

  // Panel deshabilitado (sin ADMIN_PASSWORD).
  if (!token) {
    return isApi
      ? NextResponse.json(
          { error: "Panel deshabilitado: define ADMIN_PASSWORD" },
          { status: 503 },
        )
      : NextResponse.redirect(new URL("/admin/login", req.url));
  }

  const cookie = req.cookies.get(ADMIN_COOKIE)?.value;
  if (cookie !== token) {
    return isApi
      ? NextResponse.json({ error: "No autorizado" }, { status: 401 })
      : NextResponse.redirect(new URL("/admin/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
