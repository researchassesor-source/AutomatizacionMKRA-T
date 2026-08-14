import { writeAudit } from "@/lib/audit";
import { decryptToken, encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db";
import { hasRequiredTikTokBusinessScopes, resolveTikTokBusinessConfig, type TikTokBusinessConfig } from "./config";
import { needsRefresh, refreshTokens, revokeToken, type BusinessTokens } from "./oauth";
import type { TikTokBusinessProfile } from "./publish";

export function scopesFromJson(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function describeConnection(connection: {
  socialAccountId: string;
  businessId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  grantedScopes: unknown;
  status: string;
  connectedAt: Date | null;
  refreshedAt: Date | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}) {
  return {
    accountId: connection.socialAccountId,
    businessId: connection.businessId,
    username: connection.username,
    displayName: connection.displayName,
    avatarUrl: connection.avatarUrl,
    scopes: scopesFromJson(connection.grantedScopes),
    status: connection.status,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    refreshedAt: connection.refreshedAt?.toISOString() ?? null,
    accessTokenExpiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
    refreshTokenExpiresAt: connection.refreshTokenExpiresAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage: connection.lastErrorMessage,
  };
}

export async function persistConnection(
  tokens: BusinessTokens,
  profile: TikTokBusinessProfile,
  config: TikTokBusinessConfig,
  actorEmail: string,
) {
  if (!config.encryptionKey) throw new Error("TIKTOK_BUSINESS_ENCRYPTION_KEY_MISSING");
  const now = new Date();
  const completeScopes = hasRequiredTikTokBusinessScopes(tokens.scopes);
  const account = await prisma.socialAccount.upsert({
    where: { platform_externalId: { platform: "TIKTOK", externalId: profile.businessId } },
    create: {
      platform: "TIKTOK",
      externalId: profile.businessId,
      displayName: profile.displayName ?? profile.username ?? `TikTok ${profile.businessId.slice(0, 8)}`,
      isActive: completeScopes,
      connectionStatus: completeScopes ? "READY" : "MISSING_PERMISSION",
      connectionCheckedAt: now,
    },
    update: {
      displayName: profile.displayName ?? profile.username ?? `TikTok ${profile.businessId.slice(0, 8)}`,
      isActive: completeScopes,
      connectionStatus: completeScopes ? "READY" : "MISSING_PERMISSION",
      connectionCheckedAt: now,
    },
  });
  await prisma.tikTokBusinessConnection.upsert({
    where: { socialAccountId: account.id },
    create: {
      socialAccountId: account.id,
      businessId: profile.businessId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      grantedScopes: tokens.scopes,
      accessTokenCipher: encryptToken(tokens.accessToken, config.encryptionKey),
      refreshTokenCipher: encryptToken(tokens.refreshToken, config.encryptionKey),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      status: completeScopes ? "READY" : "MISSING_PERMISSION",
      connectedAt: now,
      refreshedAt: now,
      connectionCheckedAt: now,
      lastErrorCode: completeScopes ? null : "MISSING_PERMISSION",
      lastErrorMessage: completeScopes ? null : "TikTok no concedió todos los permisos requeridos.",
    },
    update: {
      businessId: profile.businessId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      grantedScopes: tokens.scopes,
      accessTokenCipher: encryptToken(tokens.accessToken, config.encryptionKey),
      refreshTokenCipher: encryptToken(tokens.refreshToken, config.encryptionKey),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      status: completeScopes ? "READY" : "MISSING_PERMISSION",
      disconnectedAt: null,
      refreshedAt: now,
      connectionCheckedAt: now,
      lastErrorCode: completeScopes ? null : "MISSING_PERMISSION",
      lastErrorMessage: completeScopes ? null : "TikTok no concedió todos los permisos requeridos.",
    },
  });
  await writeAudit({
    actorEmail,
    action: "TIKTOK_BUSINESS_ACCOUNT_CONNECTED",
    entityType: "SocialAccount",
    entityId: account.id,
    result: completeScopes ? "SUCCESS" : "FAILURE",
    metadata: { businessIdPresent: true, scopes: tokens.scopes, permissionsComplete: completeScopes },
  });
  return { accountId: account.id, permissionsComplete: completeScopes };
}

export type AccessTokenResult =
  | { ok: true; accessToken: string; businessId: string; username: string | null }
  | { ok: false; errorCode: string; error: string; reauthRequired?: boolean };

async function markReauthRequired(socialAccountId: string, errorCode: string, error: string) {
  await prisma.$transaction([
    prisma.tikTokBusinessConnection.update({
      where: { socialAccountId },
      data: { status: "REAUTH_REQUIRED", lastErrorCode: errorCode, lastErrorMessage: error, connectionCheckedAt: new Date() },
    }),
    prisma.socialAccount.update({
      where: { id: socialAccountId },
      data: { connectionStatus: "REAUTH_REQUIRED", connectionCheckedAt: new Date(), connectionError: error },
    }),
  ]);
  await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_REAUTH_REQUIRED", entityType: "SocialAccount", entityId: socialAccountId, result: "FAILURE", metadata: { errorCode } });
}

export async function getUsableAccessToken(
  socialAccountId: string,
  config = resolveTikTokBusinessConfig(),
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<AccessTokenResult> {
  const key = config.encryptionKey;
  if (config.reason || !key) return { ok: false, errorCode: "NOT_CONFIGURED", error: config.reason ?? "TikTok Business no está configurado." };
  const connection = await prisma.tikTokBusinessConnection.findUnique({ where: { socialAccountId } });
  if (connection?.status !== "READY" || !connection.accessTokenCipher || !connection.refreshTokenCipher) {
    return { ok: false, errorCode: "NOT_CONNECTED", error: "La cuenta TikTok Business no está lista.", reauthRequired: connection?.status === "REAUTH_REQUIRED" };
  }
  if (!hasRequiredTikTokBusinessScopes(scopesFromJson(connection.grantedScopes))) {
    return { ok: false, errorCode: "MISSING_PERMISSION", error: "Faltan permisos de TikTok Business." };
  }
  if (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt <= now) {
    await markReauthRequired(socialAccountId, "REFRESH_TOKEN_EXPIRED", "La autorización de TikTok Business caducó.");
    return { ok: false, errorCode: "REFRESH_TOKEN_EXPIRED", error: "La autorización de TikTok Business caducó.", reauthRequired: true };
  }
  if (!needsRefresh(connection.accessTokenExpiresAt, now)) {
    return { ok: true, accessToken: decryptToken(connection.accessTokenCipher, key), businessId: connection.businessId, username: connection.username };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tiktok-business:${socialAccountId}`}, 0))::text AS lock_result`;
    const fresh = await tx.tikTokBusinessConnection.findUniqueOrThrow({ where: { socialAccountId } });
    if (fresh.accessTokenCipher && !needsRefresh(fresh.accessTokenExpiresAt, now)) {
      return { ok: true as const, accessToken: decryptToken(fresh.accessTokenCipher, key), businessId: fresh.businessId, username: fresh.username };
    }
    if (!fresh.refreshTokenCipher) return { ok: false as const, errorCode: "NOT_CONNECTED", error: "La cuenta no tiene refresh token.", reauthRequired: true };
    const refreshed = await refreshTokens(config, decryptToken(fresh.refreshTokenCipher, key), fetcher, now.getTime());
    if (!refreshed.ok) {
      const reauth = ["40104", "invalid_grant", "access_denied"].includes(refreshed.errorCode);
      await tx.tikTokBusinessConnection.update({
        where: { socialAccountId },
        data: { status: reauth ? "REAUTH_REQUIRED" : "ERROR", lastErrorCode: refreshed.errorCode, lastErrorMessage: refreshed.error, connectionCheckedAt: now },
      });
      await tx.socialAccount.update({ where: { id: socialAccountId }, data: { connectionStatus: reauth ? "REAUTH_REQUIRED" : "ERROR", connectionError: refreshed.error, connectionCheckedAt: now } });
      return { ok: false as const, errorCode: refreshed.errorCode, error: refreshed.error, reauthRequired: reauth };
    }
    await tx.tikTokBusinessConnection.update({
      where: { socialAccountId },
      data: {
        accessTokenCipher: encryptToken(refreshed.tokens.accessToken, key),
        refreshTokenCipher: encryptToken(refreshed.tokens.refreshToken, key),
        accessTokenExpiresAt: refreshed.tokens.accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshed.tokens.refreshTokenExpiresAt,
        refreshedAt: now,
        status: "READY",
        connectionCheckedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    return { ok: true as const, accessToken: refreshed.tokens.accessToken, businessId: fresh.businessId, username: fresh.username };
  }, { maxWait: 5_000, timeout: 20_000 });
  if (!outcome.ok && outcome.reauthRequired) {
    await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_REAUTH_REQUIRED", entityType: "SocialAccount", entityId: socialAccountId, result: "FAILURE", metadata: { errorCode: outcome.errorCode } });
  }
  return outcome;
}

export async function disconnectAccount(
  socialAccountId: string,
  config: TikTokBusinessConfig,
  actorEmail: string,
  fetcher: typeof fetch = fetch,
) {
  const connection = await prisma.tikTokBusinessConnection.findUnique({ where: { socialAccountId } });
  if (!connection) return { ok: false, revoked: false };
  let revoked = false;
  if (connection.accessTokenCipher && config.encryptionKey && !config.connectionReason) {
    try {
      revoked = (await revokeToken(config, decryptToken(connection.accessTokenCipher, config.encryptionKey), fetcher)).ok;
    } catch {
      revoked = false;
    }
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.tikTokBusinessConnection.update({
      where: { socialAccountId },
      data: {
        accessTokenCipher: null,
        refreshTokenCipher: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        status: "DISCONNECTED",
        disconnectedAt: now,
        connectionCheckedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    }),
    prisma.socialAccount.update({ where: { id: socialAccountId }, data: { isActive: false, connectionStatus: "DISCONNECTED", connectionCheckedAt: now, connectionError: null } }),
  ]);
  await writeAudit({ actorEmail, action: "TIKTOK_BUSINESS_ACCOUNT_DISCONNECTED", entityType: "SocialAccount", entityId: socialAccountId, metadata: { revokedAtProvider: revoked, historyPreserved: true } });
  return { ok: true, revoked };
}
