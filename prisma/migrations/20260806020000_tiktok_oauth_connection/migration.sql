-- Conexión OAuth por cuenta para TikTok (Login Kit) y trazabilidad de la
-- publicación mediante publish_id.
--
-- Aditiva y reversible: no elimina tablas, columnas, relaciones ni registros.
-- Las cuentas sociales existentes conservan su comportamiento; las columnas
-- nuevas quedan en NULL y ninguna ruta actual las exige.
--
-- Los tokens se guardan cifrados con AES-256-GCM. La columna histórica
-- `accessToken` en texto plano se conserva por compatibilidad pero el flujo
-- OAuth nuevo NO escribe en ella.
--
-- Reversión (ver docs/ROLLBACK.md):
--   ALTER TABLE "social_accounts"
--     DROP COLUMN "openId", DROP COLUMN "nickname", DROP COLUMN "avatarUrl",
--     DROP COLUMN "grantedScopes", DROP COLUMN "accessTokenCipher",
--     DROP COLUMN "refreshTokenCipher", DROP COLUMN "accessTokenExpiresAt",
--     DROP COLUMN "refreshTokenExpiresAt", DROP COLUMN "tokenVersion",
--     DROP COLUMN "connectedAt", DROP COLUMN "refreshedAt",
--     DROP COLUMN "disconnectedAt", DROP COLUMN "lastErrorCode",
--     DROP COLUMN "lastErrorMessage";
--   ALTER TABLE "social_posts" DROP COLUMN "publishId", DROP COLUMN "providerStatus";
--   (El valor REAUTH_REQUIRED del enum no se elimina: PostgreSQL no admite
--    quitar valores de un enum sin recrear el tipo.)

-- PostgreSQL 12+ admite añadir valores de enum dentro de una transacción
-- siempre que no se usen en la misma transacción. Es el mismo patrón que ya
-- usa 20260803130000_crm_automation_foundation.
ALTER TYPE "SocialConnectionStatus" ADD VALUE IF NOT EXISTS 'REAUTH_REQUIRED';

ALTER TABLE "social_accounts"
ADD COLUMN IF NOT EXISTS "openId" TEXT,
ADD COLUMN IF NOT EXISTS "nickname" TEXT,
ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT,
ADD COLUMN IF NOT EXISTS "grantedScopes" JSONB,
ADD COLUMN IF NOT EXISTS "accessTokenCipher" TEXT,
ADD COLUMN IF NOT EXISTS "refreshTokenCipher" TEXT,
ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "connectedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "refreshedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "disconnectedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT,
ADD COLUMN IF NOT EXISTS "lastErrorMessage" TEXT;

CREATE INDEX IF NOT EXISTS "social_accounts_platform_openId_idx" ON "social_accounts"("platform", "openId");

-- publish_id identifica la solicitud, no una publicación terminada: el estado
-- real se consulta con /v2/post/publish/status/fetch/.
ALTER TABLE "social_posts"
ADD COLUMN IF NOT EXISTS "publishId" TEXT,
ADD COLUMN IF NOT EXISTS "providerStatus" TEXT;

CREATE INDEX IF NOT EXISTS "social_posts_publishId_idx" ON "social_posts"("publishId");
