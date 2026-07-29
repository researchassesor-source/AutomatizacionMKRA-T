import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, authIsConfigured, verifySessionToken } from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const contentLength = Number(request.headers.get("content-length"));
  if (
    pathname.startsWith("/api/admin/")
    && pathname !== "/api/admin/upload"
    && Number.isFinite(contentLength)
    && contentLength > 1_048_576
  ) {
    return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
  }
  if (
    pathname === "/admin/login" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/moodle/completion"
  ) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/admin");
  if (!authIsConfigured()) {
    return isApi
      ? NextResponse.json({ error: "Acceso administrativo no configurado." }, { status: 503 })
      : NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const session = await verifySessionToken(request.cookies.get(ADMIN_COOKIE)?.value);
  if (!session) {
    return isApi
      ? NextResponse.json({ error: "No autorizado." }, { status: 401 })
      : NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const response = NextResponse.next();
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
