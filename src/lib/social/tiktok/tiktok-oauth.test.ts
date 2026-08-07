import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, parseEncryptionKey, TokenCipherError } from "@/lib/crypto/token-cipher";
import { allowedPrivacyLevels, describeTikTokConfig, isValidRedirectUri, resolveTikTokConfig } from "./config";
import {
  buildAuthorizeUrl,
  createOAuthState,
  oauthIdentity,
  exchangeCodeForTokens,
  needsRefresh,
  refreshTokens,
  revokeToken,
  verifyOAuthState,
} from "./oauth";

const KEY = Buffer.alloc(32, 7);
const STATE_SECRET = "secreto-de-estado-suficientemente-largo-para-la-prueba";
const NOW = 1_800_000_000_000;

const env = {
  TIKTOK_MODE: "sandbox",
  TIKTOK_CLIENT_KEY: "clave-de-prueba",
  TIKTOK_CLIENT_SECRET: "secreto-de-prueba",
  TIKTOK_REDIRECT_URI: "https://automatizacion-mkra-t2.vercel.app/api/integrations/tiktok/callback",
  TIKTOK_OAUTH_STATE_SECRET: STATE_SECRET,
  TIKTOK_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
} satisfies Record<string, string | undefined>;

const config = resolveTikTokConfig(env);

function jsonFetch(payload: unknown, ok = true): typeof fetch {
  return (async () => new Response(JSON.stringify(payload), { status: ok ? 200 : 400 })) as unknown as typeof fetch;
}

describe("cifrado de tokens", () => {
  it("cifra y descifra sin pérdida", () => {
    const secret = "act.ejemplo-de-token-de-acceso";
    expect(decryptToken(encryptToken(secret, KEY), KEY)).toBe(secret);
  });

  it("nunca produce el mismo criptograma dos veces", () => {
    // Un IV repetido con la misma clave rompería GCM por completo.
    expect(encryptToken("mismo-valor", KEY)).not.toBe(encryptToken("mismo-valor", KEY));
  });

  it("el criptograma no contiene el texto original", () => {
    expect(encryptToken("token-secretisimo", KEY)).not.toContain("token-secretisimo");
  });

  it("detecta manipulación del criptograma", () => {
    const encrypted = encryptToken("valor", KEY);
    const parts = encrypted.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("otro-valor").toString("base64url")].join(".");
    expect(() => decryptToken(tampered, KEY)).toThrow(TokenCipherError);
  });

  it("rechaza una clave distinta", () => {
    expect(() => decryptToken(encryptToken("valor", KEY), Buffer.alloc(32, 9))).toThrow(TokenCipherError);
  });

  it("lleva versión de formato para poder rotar", () => {
    expect(encryptToken("valor", KEY).startsWith("v1.")).toBe(true);
  });

  it("exige una clave de 32 bytes", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(TokenCipherError);
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(TokenCipherError);
    expect(parseEncryptionKey(Buffer.alloc(32, 1).toString("hex")).length).toBe(32);
  });
});

describe("configuración de TikTok", () => {
  it("es independiente de SOCIAL_MODE", () => {
    // Probar TikTok no debe obligar a poner Meta en live.
    expect(resolveTikTokConfig({ ...env, SOCIAL_MODE: "simulation" }).reason).toBeNull();
    expect(resolveTikTokConfig({ ...env, SOCIAL_MODE: "live" }).mode).toBe("sandbox");
  });

  it("queda desactivada por defecto", () => {
    expect(resolveTikTokConfig({}).mode).toBe("disabled");
    expect(resolveTikTokConfig({}).reason).toContain("desactivada");
  });

  it("explica cada credencial ausente", () => {
    expect(resolveTikTokConfig({ ...env, TIKTOK_CLIENT_SECRET: undefined }).reason).toContain("TIKTOK_CLIENT_SECRET");
    expect(resolveTikTokConfig({ ...env, TIKTOK_REDIRECT_URI: undefined }).reason).toContain("TIKTOK_REDIRECT_URI");
    expect(resolveTikTokConfig({ ...env, TIKTOK_OAUTH_STATE_SECRET: "corto" }).reason).toContain("demasiado corto");
    expect(resolveTikTokConfig({ ...env, TIKTOK_TOKEN_ENCRYPTION_KEY: undefined }).reason).toContain("TIKTOK_TOKEN_ENCRYPTION_KEY");
  });

  it("exige un redirect URI absoluto, https y sin query", () => {
    expect(isValidRedirectUri("https://crm.ra-training.com/api/integrations/tiktok/callback")).toBe(true);
    expect(isValidRedirectUri("http://crm.ra-training.com/callback")).toBe(false);
    expect(isValidRedirectUri("https://crm.ra-training.com/callback?x=1")).toBe(false);
    expect(isValidRedirectUri("https://crm.ra-training.com/callback#a")).toBe(false);
    expect(isValidRedirectUri("/api/callback")).toBe(false);
  });

  it("en sandbox solo permite SELF_ONLY", () => {
    // El cliente sin auditar no puede publicar en otro nivel.
    expect(allowedPrivacyLevels(config)).toEqual(["SELF_ONLY"]);
    expect(allowedPrivacyLevels(resolveTikTokConfig({ ...env, TIKTOK_MODE: "live" }))).toContain("PUBLIC_TO_EVERYONE");
  });

  it("el resumen para la interfaz no expone credenciales", () => {
    const summary = JSON.stringify(describeTikTokConfig(config));
    expect(summary).not.toContain("secreto-de-prueba");
    expect(summary).not.toContain("clave-de-prueba");
    expect(summary).not.toContain(KEY.toString("base64"));
    expect(describeTikTokConfig(config).clientSecretConfigured).toBe(true);
  });
});

describe("state de OAuth", () => {
  const admin = "admin-1";

  it("acepta un state íntegro emitido por nosotros", () => {
    const { state } = createOAuthState(admin, STATE_SECRET, NOW);
    expect(verifyOAuthState(state, state, STATE_SECRET, admin, NOW + 1000)).toMatchObject({ ok: true });
  });

  it("rechaza firma inválida", () => {
    const { state } = createOAuthState(admin, STATE_SECRET, NOW);
    const [payload] = state.split(".");
    const forged = `${payload}.firma-inventada`;
    expect(verifyOAuthState(forged, forged, STATE_SECRET, admin, NOW)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("rechaza un state caducado", () => {
    const { state } = createOAuthState(admin, STATE_SECRET, NOW);
    expect(verifyOAuthState(state, state, STATE_SECRET, admin, NOW + 601_000)).toMatchObject({ ok: false, reason: "EXPIRED" });
  });

  it("rechaza un state que no coincide con la cookie", () => {
    const { state } = createOAuthState(admin, STATE_SECRET, NOW);
    const otro = createOAuthState(admin, STATE_SECRET, NOW).state;
    expect(verifyOAuthState(state, otro, STATE_SECRET, admin, NOW)).toMatchObject({ ok: false, reason: "MISMATCHED_COOKIE" });
  });

  it("rechaza un state de otro administrador", () => {
    const { state } = createOAuthState("admin-2", STATE_SECRET, NOW);
    expect(verifyOAuthState(state, state, STATE_SECRET, admin, NOW)).toMatchObject({ ok: false, reason: "WRONG_ADMIN" });
  });

  it("rechaza state ausente o malformado", () => {
    expect(verifyOAuthState(null, null, STATE_SECRET, admin, NOW)).toMatchObject({ ok: false, reason: "MALFORMED" });
    expect(verifyOAuthState("basura", "basura", STATE_SECRET, admin, NOW)).toMatchObject({ ok: false, reason: "MALFORMED" });
  });

  it("el acceso compartido tambien obtiene una identidad estable", () => {
    // Exigir userId dejaba que el acceso compartido desconectara una cuenta
    // pero no pudiera reconectarla: podia romper sin poder arreglar.
    const compartida = { userId: null, email: "legacy-local" };
    const identidad = oauthIdentity(compartida);
    expect(identidad).toBe("legacy:legacy-local");
    const { state } = createOAuthState(identidad, STATE_SECRET, NOW);
    expect(verifyOAuthState(state, state, STATE_SECRET, identidad, NOW)).toMatchObject({ ok: true });
  });

  it("un usuario individual sigue teniendo identidad propia", () => {
    expect(oauthIdentity({ userId: "user-1", email: "a@b.test" })).toBe("user-1");
    // Y no puede cerrar un flujo iniciado por el acceso compartido.
    const { state } = createOAuthState("legacy:legacy-local", STATE_SECRET, NOW);
    expect(verifyOAuthState(state, state, STATE_SECRET, "user-1", NOW)).toMatchObject({ ok: false, reason: "WRONG_ADMIN" });
  });

  it("dos states consecutivos son distintos", () => {
    expect(createOAuthState(admin, STATE_SECRET, NOW).state).not.toBe(createOAuthState(admin, STATE_SECRET, NOW).state);
  });
});

describe("URL de autorización", () => {
  it("incluye los parámetros exigidos y ningún secreto", () => {
    const url = new URL(buildAuthorizeUrl(config, "estado-firmado"));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_key")).toBe("clave-de-prueba");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.upload,video.publish");
    expect(url.searchParams.get("redirect_uri")).toBe(env.TIKTOK_REDIRECT_URI);
    expect(url.toString()).not.toContain("secreto-de-prueba");
  });

  it("puede forzar la pantalla de consentimiento al reconectar", () => {
    expect(buildAuthorizeUrl(config, "s")).not.toContain("disable_auto_auth");
    expect(buildAuthorizeUrl(config, "s", { forceConsent: true })).toContain("disable_auto_auth=1");
  });
});

describe("intercambio y renovación de tokens", () => {
  const success = {
    access_token: "act.token-de-acceso",
    refresh_token: "rft.token-de-refresco",
    open_id: "open-id-123",
    scope: "user.info.basic,video.upload",
    expires_in: 86_400,
    refresh_expires_in: 31_536_000,
  };

  it("convierte la respuesta en tokens con fechas de caducidad", async () => {
    const result = await exchangeCodeForTokens(config, "codigo", jsonFetch(success), NOW);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.tokens.openId).toBe("open-id-123");
    expect(result.tokens.scopes).toEqual(["user.info.basic", "video.upload"]);
    expect(result.tokens.accessTokenExpiresAt.getTime()).toBe(NOW + 86_400_000);
  });

  it("envía el redirect_uri exacto y el grant correcto", async () => {
    let body = "";
    const spy = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify(success));
    }) as unknown as typeof fetch;
    await exchangeCodeForTokens(config, "codigo", spy, NOW);
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("redirect_uri")).toBe(env.TIKTOK_REDIRECT_URI);
    expect(params.get("code")).toBe("codigo");
  });

  it("conserva el refresh token rotado", async () => {
    const rotated = { ...success, refresh_token: "rft.token-nuevo" };
    const result = await refreshTokens(config, "rft.token-viejo", jsonFetch(rotated), NOW);
    expect(result.ok && result.tokens.refreshToken).toBe("rft.token-nuevo");
  });

  it("traduce los errores de TikTok sin filtrar detalle técnico", async () => {
    const result = await exchangeCodeForTokens(config, "codigo", jsonFetch({ error: "invalid_grant", error_description: "detalle interno" }), NOW);
    expect(result).toMatchObject({ ok: false, errorCode: "invalid_grant" });
    if (result.ok) return;
    expect(result.error).toContain("Vuelve a conectar");
    expect(result.error).not.toContain("detalle interno");
  });

  it("rechaza una respuesta incompleta en lugar de guardar basura", async () => {
    const result = await exchangeCodeForTokens(config, "codigo", jsonFetch({ access_token: "solo-acceso" }), NOW);
    expect(result).toMatchObject({ ok: false, errorCode: "INCOMPLETE_TOKEN_RESPONSE" });
  });

  it("no lanza ante un fallo de red", async () => {
    const failing = (async () => { throw new Error("sin red"); }) as unknown as typeof fetch;
    expect(await exchangeCodeForTokens(config, "codigo", failing, NOW)).toMatchObject({ ok: false, errorCode: "NETWORK_ERROR" });
  });

  it("revoca el acceso contra el endpoint oficial", async () => {
    let called = "";
    const spy = (async (url: string) => { called = url; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await revokeToken(config, "act.token", spy)).toMatchObject({ ok: true });
    expect(called).toBe("https://open.tiktokapis.com/v2/oauth/revoke/");
  });
});

describe("renovación anticipada", () => {
  const now = new Date(NOW);
  it("renueva antes de caducar, no después", () => {
    expect(needsRefresh(new Date(NOW + 30_000), now)).toBe(true);
    expect(needsRefresh(new Date(NOW + 3_600_000), now)).toBe(false);
    expect(needsRefresh(null, now)).toBe(true);
  });
});
