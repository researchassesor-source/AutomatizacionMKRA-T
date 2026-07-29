import { NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth/authorization";

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return NextResponse.json({
    name: session.name,
    email: session.email,
    role: session.role,
    legacy: session.legacy,
  });
}
