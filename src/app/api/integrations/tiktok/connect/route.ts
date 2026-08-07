import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { resolveTikTokConfig } from "@/lib/social/tiktok/config";
import { buildAuthorizeUrl, createOAuthState, STATE_COOKIE, STATE_TTL_SECONDS } from "@/lib/social/tiktok/oauth";

export const dynamic = "force-dynamic";

/**
 * Inicia el flujo de Login Kit. Solo ADMIN: autorizar una cuenta de TikTok
 * habilita publicar en nombre de la organización.
 *
 * Es POST y no GET a propósito: un GET podría dispararse desde una etiqueta
 * <img> de otra web. `requireRole` ya exige mismo origen para métodos que no
 * son de lectura.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;

  const limit = await checkRateLimit(requestKey(request, "tiktok-connect"), { limit: 10, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos de conexión. Espera unos minutos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const config = resolveTikTokConfig();
  if (config.reason) {
    return NextResponse.json({ error: config.reason }, { status: 422 });
  }

  // El acceso heredado compartido no tiene identidad individual: sin ella el
  // `state` no puede quedar ligado a una persona concreta.
  const adminId = auth.session?.userId;
  if (!adminId) {
    return NextResponse.json(
      { error: "Conectar TikTok requiere una cuenta administrativa individual, no el acceso compartido heredado." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { reconnect?: boolean };
  const { state } = createOAuthState(adminId, config.stateSecret ?? "");
  // Al reconectar se fuerza la pantalla de consentimiento: si no, TikTok
  // reutiliza la autorización previa y el paso queda invisible.
  const authorizeUrl = buildAuthorizeUrl(config, state, { forceConsent: Boolean(body.reconnect) });

  await writeAudit({
    session: auth.session,
    action: "TIKTOK_OAUTH_STARTED",
    entityType: "SocialAccount",
    metadata: { mode: config.mode, reconnect: Boolean(body.reconnect) },
  });

  const response = NextResponse.json({ ok: true, authorizeUrl });
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // El retorno de TikTok es una navegación de nivel superior.
    path: "/api/integrations/tiktok",
    maxAge: STATE_TTL_SECONDS,
  });
  return response;
}
