import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { sessionFromRequest } from "@/lib/auth/authorization";
import { TECNICO } from "@/lib/auth/roles";
import { persistConnection } from "@/lib/social/tiktok-business/account";
import { resolveTikTokBusinessConfig } from "@/lib/social/tiktok-business/config";
import { exchangeCodeForTokens, oauthIdentity, STATE_COOKIE, verifyOAuthState } from "@/lib/social/tiktok-business/oauth";
import { getBusinessProfile } from "@/lib/social/tiktok-business/publish";

export const dynamic = "force-dynamic";
const PANEL = "/admin/redes";

function back(status: string) {
  const base = process.env.APP_URL?.trim() || "https://automatizacion-mkra-t2.vercel.app";
  return NextResponse.redirect(new URL(`${PANEL}?tiktokBusiness=${encodeURIComponent(status)}`, base));
}

function clearState(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/tiktok-business", maxAge: 0 });
  return response;
}

function cookieValue(request: Request): string | null {
  const raw = request.headers.get("cookie")?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];
  return raw ? decodeURIComponent(raw) : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hasOAuthParameters = ["auth_code", "state", "error"].some((parameter) => url.searchParams.has(parameter));
  if (!hasOAuthParameters) {
    return clearState(NextResponse.json(
      { ok: false, error: "Faltan los parámetros de autorización de TikTok Business." },
      { status: 400 },
    ));
  }
  const config = resolveTikTokBusinessConfig();
  if (config.connectionReason) return clearState(back("no_configurado"));

  const providerError = url.searchParams.get("error");
  if (providerError) {
    await writeAudit({ actorEmail: "tiktok-business-oauth", action: "TIKTOK_BUSINESS_OAUTH_FAILED", entityType: "SocialAccount", result: "FAILURE", metadata: { providerError: providerError.slice(0, 120) } });
    return clearState(back(providerError === "access_denied" ? "cancelado" : "error_proveedor"));
  }

  const session = await sessionFromRequest(request);
  if (!session || !TECNICO.includes(session.role)) return clearState(back("sesion_invalida"));
  const verification = verifyOAuthState(url.searchParams.get("state"), cookieValue(request), config.stateSecret ?? "", oauthIdentity(session));
  if (!verification.ok) {
    await writeAudit({ session, action: "TIKTOK_BUSINESS_OAUTH_STATE_REJECTED", entityType: "SocialAccount", result: "FAILURE", metadata: { reason: verification.reason } });
    return clearState(back("estado_invalido"));
  }

  const authCode = url.searchParams.get("auth_code");
  if (!authCode) return clearState(back("sin_codigo"));
  const exchange = await exchangeCodeForTokens(config, authCode);
  if (!exchange.ok) {
    await writeAudit({ session, action: "TIKTOK_BUSINESS_OAUTH_EXCHANGE_FAILED", entityType: "SocialAccount", result: "FAILURE", metadata: { errorCode: exchange.errorCode } });
    return clearState(back("error_token"));
  }
  const profile = await getBusinessProfile(exchange.tokens.accessToken, exchange.tokens.businessId);
  if (!profile.ok || profile.data.businessId !== exchange.tokens.businessId) {
    await writeAudit({ session, action: "TIKTOK_BUSINESS_ACCOUNT_LOOKUP_FAILED", entityType: "SocialAccount", result: "FAILURE", metadata: { accountMatched: false, errorCode: profile.ok ? "ACCOUNT_MISMATCH" : profile.errorCode } });
    return clearState(back("error_cuenta"));
  }
  try {
    const stored = await persistConnection(exchange.tokens, profile.data, config, session.email);
    return clearState(back(stored.permissionsComplete ? "conectado" : "permisos_insuficientes"));
  } catch {
    await writeAudit({ session, action: "TIKTOK_BUSINESS_OAUTH_PERSIST_FAILED", entityType: "SocialAccount", result: "FAILURE", metadata: { stage: "persist" } });
    return clearState(back("error_guardado"));
  }
}
