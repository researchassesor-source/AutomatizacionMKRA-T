import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { sessionFromRequest } from "@/lib/auth/authorization";
import { persistConnection, type ProfileInfo } from "@/lib/social/tiktok/account";
import { resolveTikTokConfig } from "@/lib/social/tiktok/config";
import { exchangeCodeForTokens, oauthIdentity, STATE_COOKIE, verifyOAuthState } from "@/lib/social/tiktok/oauth";

export const dynamic = "force-dynamic";

const PANEL = "/admin/redes";

/** Vuelve al panel con un estado legible; nunca con tokens en la URL. */
function back(status: string, detail?: string) {
  const params = new URLSearchParams({ tiktok: status });
  if (detail) params.set("detalle", detail.slice(0, 160));
  return NextResponse.redirect(new URL(`${PANEL}?${params}`, process.env.APP_URL ?? "https://automatizacion-mkra-t2.vercel.app"));
}

function clearState(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/tiktok", maxAge: 0 });
  return response;
}

async function fetchProfile(accessToken: string, openId: string): Promise<ProfileInfo> {
  try {
    const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } };
    };
    const user = payload.data?.user;
    return { openId: user?.open_id ?? openId, nickname: user?.display_name ?? null, avatarUrl: user?.avatar_url ?? null };
  } catch {
    // El perfil es informativo: si falla, la conexión sigue siendo válida.
    return { openId, nickname: null, avatarUrl: null };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = resolveTikTokConfig();
  if (config.reason) return clearState(back("no_configurado", config.reason));

  // TikTok informa aquí que la persona rechazó el permiso.
  const providerError = url.searchParams.get("error");
  if (providerError) {
    await writeAudit({
      actorEmail: "tiktok-oauth",
      action: "TIKTOK_OAUTH_DENIED",
      entityType: "SocialAccount",
      result: "FAILURE",
      metadata: { error: providerError.slice(0, 120) },
    });
    return clearState(back(providerError === "access_denied" ? "cancelado" : "error_proveedor"));
  }

  // La sesión administrativa debe seguir activa: el `state` se emitió para ella.
  const session = await sessionFromRequest(request);
  if (session?.role !== "ADMIN") return clearState(back("sesion_invalida"));

  const cookieState = request.headers.get("cookie")?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];
  const verification = verifyOAuthState(
    url.searchParams.get("state"),
    cookieState ? decodeURIComponent(cookieState) : null,

    config.stateSecret ?? "",
    oauthIdentity(session),
  );
  if (!verification.ok) {
    await writeAudit({
      session,
      action: "TIKTOK_OAUTH_STATE_REJECTED",
      entityType: "SocialAccount",
      result: "FAILURE",
      metadata: { reason: verification.reason },
    });
    return clearState(back("estado_invalido"));
  }

  const code = url.searchParams.get("code");
  if (!code) return clearState(back("sin_codigo"));

  const exchange = await exchangeCodeForTokens(config, code);
  if (!exchange.ok) {
    await writeAudit({
      session,
      action: "TIKTOK_OAUTH_EXCHANGE_FAILED",
      entityType: "SocialAccount",
      result: "FAILURE",
      metadata: { errorCode: exchange.errorCode },
    });
    return clearState(back("error_token", exchange.error));
  }

  try {
    const profile = await fetchProfile(exchange.tokens.accessToken, exchange.tokens.openId);
    await persistConnection(exchange.tokens, profile, config, session.email);
    return clearState(back("conectado", profile.nickname ?? undefined));
  } catch {
    await writeAudit({
      session,
      action: "TIKTOK_OAUTH_PERSIST_FAILED",
      entityType: "SocialAccount",
      result: "FAILURE",
      metadata: { stage: "persist" },
    });
    return clearState(back("error_guardado"));
  }
}
