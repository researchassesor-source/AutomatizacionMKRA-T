import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { TECNICO } from "@/lib/auth/roles";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { resolveTikTokBusinessConfig } from "@/lib/social/tiktok-business/config";
import { buildAuthorizeUrl, createOAuthState, oauthIdentity, STATE_COOKIE, STATE_TTL_SECONDS } from "@/lib/social/tiktok-business/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;
  const limit = await checkRateLimit(requestKey(request, "tiktok-business-connect"), { limit: 10, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const config = resolveTikTokBusinessConfig();
  if (config.connectionReason) return NextResponse.json({ error: config.connectionReason }, { status: 422 });
  if (!auth.session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { reconnect?: boolean };
  const { state } = createOAuthState(oauthIdentity(auth.session), config.stateSecret ?? "");
  const authorizeUrl = buildAuthorizeUrl(config, state, Boolean(body.reconnect));
  await writeAudit({ session: auth.session, action: "TIKTOK_BUSINESS_OAUTH_STARTED", entityType: "SocialAccount", metadata: { reconnect: Boolean(body.reconnect) } });
  const response = NextResponse.json({ ok: true, authorizeUrl });
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/integrations/tiktok-business",
    maxAge: STATE_TTL_SECONDS,
  });
  return response;
}
