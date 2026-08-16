-- Arquitectura comercial: compras del curso de 60 horas y campaña de oferta
-- institucional.
--
-- Migracion ESTRICTAMENTE ADITIVA. No hay DROP, ni TRUNCATE, ni renombrados, ni
-- columnas NOT NULL sin valor por defecto sobre tablas con datos. Las columnas
-- nuevas de `courses` y `enrollments` admiten NULL o traen DEFAULT, de modo que
-- las filas existentes quedan validas sin tocarlas.
--
-- Deliberadamente NO se rellena nada a partir de datos historicos: deducir quien
-- compro a partir del importe o del estado heredado seria inventar, y en los
-- cursos previos esa decision la toma una persona.

-- ─── Enums nuevos ──────────────────────────────────────────────────────────
CREATE TYPE "CoursePurchaseType" AS ENUM ('FULL', 'INSTITUTIONAL', 'AVAL_UPGRADE');

CREATE TYPE "CoursePurchaseStatus" AS ENUM ('PENDING', 'SENT_TO_FINANCE', 'PAYMENT_PENDING', 'PAYMENT_VERIFIED', 'CANCELLED', 'ERROR');

CREATE TYPE "CertificationTier" AS ENUM ('NONE', 'INSTITUTIONAL', 'FULL');

CREATE TYPE "FinanceCommercialState" AS ENUM ('NO_PURCHASE', 'FULL_PENDING', 'FULL_VERIFIED', 'INSTITUTIONAL_PENDING', 'INSTITUTIONAL_VERIFIED', 'UPGRADE_PENDING', 'FULL_UPGRADED', 'CANCELLED', 'LEGACY_UNCLASSIFIED');

CREATE TYPE "CampaignAudienceMode" AS ENUM ('HISTORICAL_MANUAL', 'AUTOMATIC_COMMERCE');

CREATE TYPE "CertificationOfferStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');

CREATE TYPE "OfferRecipientEligibility" AS ENUM ('PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE_PURCHASED', 'NOT_ELIGIBLE_PENDING_PAYMENT', 'REQUIRES_REVIEW', 'EXCLUDED', 'SENT', 'ERROR');

-- ─── Configuracion comercial del curso ─────────────────────────────────────
ALTER TABLE "courses" ADD COLUMN "fullOfferPrice" DECIMAL(10,2);
ALTER TABLE "courses" ADD COLUMN "institutionalOfferPrice" DECIMAL(10,2);
ALTER TABLE "courses" ADD COLUMN "upgradeOfferPrice" DECIMAL(10,2);
ALTER TABLE "courses" ADD COLUMN "institutionalOfferUrl" TEXT;
ALTER TABLE "courses" ADD COLUMN "upgradeOfferUrl" TEXT;
ALTER TABLE "courses" ADD COLUMN "institutionalOfferDelayHours" INTEGER NOT NULL DEFAULT 24;

-- ─── Derecho de acceso del inscrito ────────────────────────────────────────
-- `false` de partida a proposito: el derecho solo lo concede un pago verificado
-- por Finance, nunca un dato historico.
ALTER TABLE "enrollments" ADD COLUMN "fullCourseAccessEntitled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "enrollments" ADD COLUMN "fullCourseAccessEntitledAt" TIMESTAMP(3);
ALTER TABLE "enrollments" ADD COLUMN "effectiveCertificationTier" "CertificationTier" NOT NULL DEFAULT 'NONE';

-- ─── Compras ───────────────────────────────────────────────────────────────
CREATE TABLE "course_purchases" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "offerType" "CoursePurchaseType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "CoursePurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "parentPurchaseId" TEXT,
    "financeInscripcionId" TEXT,
    "financePaymentStatus" TEXT,
    "paymentVerifiedAt" TIMESTAMP(3),
    "financeCommercialState" "FinanceCommercialState",
    "lastFinanceSyncAt" TIMESTAMP(3),
    "lastFinanceError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_purchases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "course_purchases_enrollmentId_offerType_idx" ON "course_purchases"("enrollmentId", "offerType");
CREATE INDEX "course_purchases_status_idx" ON "course_purchases"("status");
CREATE INDEX "course_purchases_financeInscripcionId_idx" ON "course_purchases"("financeInscripcionId");

ALTER TABLE "course_purchases" ADD CONSTRAINT "course_purchases_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL y no CASCADE: si alguna vez se borrara la compra institucional, la
-- mejora debe quedar visible como huerfana en lugar de desaparecer sin rastro.
ALTER TABLE "course_purchases" ADD CONSTRAINT "course_purchases_parentPurchaseId_fkey"
    FOREIGN KEY ("parentPurchaseId") REFERENCES "course_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Campaña de oferta institucional ───────────────────────────────────────
CREATE TABLE "certification_offer_campaigns" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "audienceMode" "CampaignAudienceMode" NOT NULL,
    "status" "CertificationOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "automaticScheduledAt" TIMESTAMP(3),
    "automaticExecutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certification_offer_campaigns_pkey" PRIMARY KEY ("id")
);

-- Una sola campaña por curso: dos campañas sobre la misma audiencia acabarian
-- escribiendo dos veces a la misma persona.
CREATE UNIQUE INDEX "certification_offer_campaigns_courseId_key" ON "certification_offer_campaigns"("courseId");
CREATE INDEX "certification_offer_campaigns_status_automaticScheduledAt_idx" ON "certification_offer_campaigns"("status", "automaticScheduledAt");

ALTER TABLE "certification_offer_campaigns" ADD CONSTRAINT "certification_offer_campaigns_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Destinatarios de la campaña ───────────────────────────────────────────
CREATE TABLE "certification_offer_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "eligibilityStatus" "OfferRecipientEligibility" NOT NULL DEFAULT 'PENDING',
    "commercialStateSnapshot" "FinanceCommercialState",
    "effectiveEntitlementSnapshot" "CertificationTier",
    "manuallyApprovedAt" TIMESTAMP(3),
    "manuallyApprovedBy" TEXT,
    "manualExcludedAt" TIMESTAMP(3),
    "manualExcludedBy" TEXT,
    "manualSentAt" TIMESTAMP(3),
    "automaticSentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "lastEligibilityCheckAt" TIMESTAMP(3),
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certification_offer_recipients_pkey" PRIMARY KEY ("id")
);

-- Es la barrera contra duplicados: una persona no puede figurar dos veces en la
-- misma campaña, ni por reintento manual ni por ejecucion concurrente del cron.
CREATE UNIQUE INDEX "certification_offer_recipients_campaignId_enrollmentId_key" ON "certification_offer_recipients"("campaignId", "enrollmentId");
CREATE INDEX "certification_offer_recipients_campaignId_eligibilityStatus_idx" ON "certification_offer_recipients"("campaignId", "eligibilityStatus");

ALTER TABLE "certification_offer_recipients" ADD CONSTRAINT "certification_offer_recipients_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "certification_offer_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "certification_offer_recipients" ADD CONSTRAINT "certification_offer_recipients_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
