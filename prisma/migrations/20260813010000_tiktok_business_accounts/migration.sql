-- TikTok for Business / Accounts API: conexión aislada del Login Kit legacy.
-- Migración estrictamente aditiva: no elimina ni transforma datos existentes.
CREATE TABLE "tiktok_business_connections" (
  "id" TEXT NOT NULL,
  "socialAccountId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "username" TEXT,
  "displayName" TEXT,
  "avatarUrl" TEXT,
  "grantedScopes" JSONB,
  "accessTokenCipher" TEXT,
  "refreshTokenCipher" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshTokenExpiresAt" TIMESTAMP(3),
  "tokenVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "SocialConnectionStatus" NOT NULL DEFAULT 'UNKNOWN',
  "connectedAt" TIMESTAMP(3),
  "refreshedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "connectionCheckedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tiktok_business_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tiktok_business_connections_socialAccountId_key"
  ON "tiktok_business_connections"("socialAccountId");
CREATE UNIQUE INDEX "tiktok_business_connections_businessId_key"
  ON "tiktok_business_connections"("businessId");
CREATE INDEX "tiktok_business_connections_status_idx"
  ON "tiktok_business_connections"("status");

ALTER TABLE "tiktok_business_connections"
  ADD CONSTRAINT "tiktok_business_connections_socialAccountId_fkey"
  FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
