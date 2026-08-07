import { writeAudit } from "@/lib/audit";
import { decryptToken, encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db";
import { resolveTikTokConfig, type TikTokConfig } from "./config";
import { needsRefresh, refreshTokens, revokeToken, type TikTokTokens } from "./oauth";

/**
 * Persistencia de la conexión de TikTok.
 *
 * Los tokens solo existen en claro dentro de este módulo y durante el tiempo
 * mínimo. Nada de lo que sale de aquí hacia rutas, respuestas o auditoría
 * contiene material sensible.
 */
export type StoredConnection = {
  accountId: string;
  openId: string;
  nickname: string | null;
  avatarUrl: string | null;
  scopes: string[];
  connectionStatus: string;
  connectedAt: Date | null;
  refreshedAt: Date | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

/** Vista segura para la interfaz: jamás incluye tokens. */
export function describeConnection(account: {
  id: string;
  openId: string | null;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
  grantedScopes: unknown;
  connectionStatus: string;
  connectedAt: Date | null;
  refreshedAt: Date | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  isActive: boolean;
}) {
  return {
    accountId: account.id,
    openId: account.openId,
    nickname: account.nickname ?? account.displayName,
    avatarUrl: account.avatarUrl,
    scopes: Array.isArray(account.grantedScopes) ? (account.grantedScopes as string[]) : [],
    connectionStatus: account.connectionStatus,
    isActive: account.isActive,
    connectedAt: account.connectedAt?.toISOString() ?? null,
    refreshedAt: account.refreshedAt?.toISOString() ?? null,
    accessTokenExpiresAt: account.accessTokenExpiresAt?.toISOString() ?? null,
    refreshTokenExpiresAt: account.refreshTokenExpiresAt?.toISOString() ?? null,
    lastErrorCode: account.lastErrorCode,
    lastErrorMessage: account.lastErrorMessage,
  };
}

export type ProfileInfo = { openId: string; nickname: string | null; avatarUrl: string | null };

/**
 * Guarda o actualiza la cuenta tras una autorización correcta.
 *
 * La identidad es (platform, externalId=openId): reconectar la misma cuenta
 * actualiza el registro existente en lugar de duplicarlo.
 */
export async function persistConnection(
  tokens: TikTokTokens,
  profile: ProfileInfo,
  config: TikTokConfig,
  actorEmail: string,
): Promise<string> {
  if (!config.encryptionKey) throw new Error("TIKTOK_ENCRYPTION_KEY_MISSING");
  const now = new Date();
  const data = {
    displayName: profile.nickname ?? `TikTok ${profile.openId.slice(0, 8)}`,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    openId: profile.openId,
    grantedScopes: tokens.scopes,
    accessTokenCipher: encryptToken(tokens.accessToken, config.encryptionKey),
    refreshTokenCipher: encryptToken(tokens.refreshToken, config.encryptionKey),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    tokenVersion: 1,
    refreshedAt: now,
    disconnectedAt: null,
    isActive: true,
    connectionStatus: "READY" as const,
    connectionCheckedAt: now,
    connectionError: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };

  const account = await prisma.socialAccount.upsert({
    where: { platform_externalId: { platform: "TIKTOK", externalId: profile.openId } },
    create: { platform: "TIKTOK", externalId: profile.openId, connectedAt: now, ...data },
    update: data,
  });

  await writeAudit({
    actorEmail,
    action: "TIKTOK_ACCOUNT_CONNECTED",
    entityType: "SocialAccount",
    entityId: account.id,
    // Solo metadatos verificables: nada de tokens.
    metadata: { openIdPresent: true, scopes: tokens.scopes, mode: config.mode, nickname: profile.nickname },
  });
  return account.id;
}

export type AccessTokenResult =
  | { ok: true; accessToken: string; accountId: string }
  | { ok: false; errorCode: string; error: string; reauthRequired?: boolean };

/**
 * Devuelve un access token utilizable, renovándolo si está por caducar.
 *
 * El refresco se serializa con un advisory lock por cuenta: dos publicaciones
 * simultáneas podrían refrescar a la vez y, como TikTok rota el refresh token,
 * la segunda invalidaría el de la primera y dejaría la conexión rota.
 */
export async function getUsableAccessToken(
  accountId: string,
  config: TikTokConfig = resolveTikTokConfig(),
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<AccessTokenResult> {
  const key = config.encryptionKey;
  if (!key) {
    return { ok: false, errorCode: "TIKTOK_NOT_CONFIGURED", error: "Falta la clave de cifrado de tokens." };
  }
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (account?.platform !== "TIKTOK") {
    return { ok: false, errorCode: "ACCOUNT_NOT_FOUND", error: "No se encontró la cuenta de TikTok." };
  }
  if (!account.accessTokenCipher || !account.refreshTokenCipher) {
    return { ok: false, errorCode: "NOT_CONNECTED", error: "La cuenta no está conectada con TikTok.", reauthRequired: true };
  }
  if (account.refreshTokenExpiresAt && account.refreshTokenExpiresAt <= now) {
    await markReauthRequired(accountId, "REFRESH_TOKEN_EXPIRED", "La autorización de TikTok caducó. Vuelve a conectar la cuenta.");
    return { ok: false, errorCode: "REFRESH_TOKEN_EXPIRED", error: "La autorización de TikTok caducó.", reauthRequired: true };
  }

  if (!needsRefresh(account.accessTokenExpiresAt, now)) {
    return { ok: true, accessToken: decryptToken(account.accessTokenCipher, key), accountId };
  }

  return prisma.$transaction(async (tx) => {
    // Serializa por cuenta: quien llegue segundo espera y encuentra el token ya
    // renovado en lugar de pedir otro refresh.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok:${accountId}`}, 0))::text AS lock_result`;
    const fresh = await tx.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (fresh.accessTokenCipher && !needsRefresh(fresh.accessTokenExpiresAt, now)) {
      return { ok: true as const, accessToken: decryptToken(fresh.accessTokenCipher, key), accountId };
    }
    if (!fresh.refreshTokenCipher) {
      return { ok: false as const, errorCode: "NOT_CONNECTED", error: "La cuenta no está conectada con TikTok.", reauthRequired: true };
    }

    const refreshed = await refreshTokens(config, decryptToken(fresh.refreshTokenCipher, key), fetcher, now.getTime());
    if (!refreshed.ok) {
      const reauth = ["invalid_grant", "access_denied", "invalid_request"].includes(refreshed.errorCode);
      await tx.socialAccount.update({
        where: { id: accountId },
        data: {
          connectionStatus: reauth ? "REAUTH_REQUIRED" : "ERROR",
          lastErrorCode: refreshed.errorCode,
          lastErrorMessage: refreshed.error,
          connectionCheckedAt: now,
        },
      });
      return { ok: false as const, errorCode: refreshed.errorCode, error: refreshed.error, reauthRequired: reauth };
    }

    await tx.socialAccount.update({
      where: { id: accountId },
      data: {
        accessTokenCipher: encryptToken(refreshed.tokens.accessToken, key),
        // TikTok rota el refresh token: guardar el nuevo es obligatorio, si no
        // la próxima renovación fallaría.
        refreshTokenCipher: encryptToken(refreshed.tokens.refreshToken, key),
        accessTokenExpiresAt: refreshed.tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.tokens.refreshTokenExpiresAt,
        refreshedAt: now,
        connectionStatus: "READY",
        connectionCheckedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    return { ok: true as const, accessToken: refreshed.tokens.accessToken, accountId };
  }, { maxWait: 5_000, timeout: 15_000 });
}

export async function markReauthRequired(accountId: string, code: string, message: string) {
  await prisma.socialAccount.update({
    where: { id: accountId },
    data: { connectionStatus: "REAUTH_REQUIRED", lastErrorCode: code, lastErrorMessage: message, connectionCheckedAt: new Date() },
  });
}

/**
 * Desconexión: revoca en TikTok y borra el material criptográfico.
 *
 * No elimina la cuenta ni sus publicaciones: el historial es evidencia y se
 * conserva. La cuenta queda DESCONECTADA e inactiva.
 */
export async function disconnectAccount(
  accountId: string,
  config: TikTokConfig,
  actorEmail: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; revoked: boolean }> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (account?.platform !== "TIKTOK") return { ok: false, revoked: false };

  let revoked = false;
  if (account.accessTokenCipher && config.encryptionKey) {
    try {
      const result = await revokeToken(config, decryptToken(account.accessTokenCipher, config.encryptionKey), fetcher);
      revoked = result.ok;
    } catch {
      // Que TikTok no responda no puede impedir borrar el token de nuestro lado.
      revoked = false;
    }
  }

  await prisma.socialAccount.update({
    where: { id: accountId },
    data: {
      accessTokenCipher: null,
      refreshTokenCipher: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      isActive: false,
      connectionStatus: "DISCONNECTED",
      disconnectedAt: new Date(),
      connectionCheckedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  await writeAudit({
    actorEmail,
    action: "TIKTOK_ACCOUNT_DISCONNECTED",
    entityType: "SocialAccount",
    entityId: accountId,
    metadata: { revokedAtProvider: revoked, historyPreserved: true },
  });
  return { ok: true, revoked };
}
