import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth/session";
import { sessionFromRequest } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  await writeAudit({ session, action: "AUTH_LOGOUT", entityType: "Session" });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
