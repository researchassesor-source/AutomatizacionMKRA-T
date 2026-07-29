-- Non-destructive CRM expansion from the b1ca4fe baseline.
-- No table or column is dropped. Legacy Lead.courseId and
-- Lead.financeInscripcionId remain available during the transition.

CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'MARKETING', 'VENTAS', 'LECTURA');
CREATE TYPE "EnrollmentStatus" AS ENUM ('INTERESADO', 'INSCRITO', 'EN_CURSO', 'COMPLETADO', 'CANCELADO');
CREATE TYPE "FinanceStatus" AS ENUM ('NO_ENVIADO', 'PENDIENTE', 'ENVIANDO', 'ENVIADO', 'ERROR');
CREATE TYPE "CertificateStatus" AS ENUM ('PENDIENTE', 'EMITIDO', 'ANULADO', 'DESCONOCIDO');
CREATE TYPE "FollowUpType" AS ENUM ('LLAMADA', 'WHATSAPP', 'CORREO', 'REUNION', 'RECORDATORIO', 'OTRO');
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDIENTE', 'COMPLETADO', 'CANCELADO', 'VENCIDO');

ALTER TYPE "PostStatus" ADD VALUE 'SIMULADO';
ALTER TYPE "PostStatus" ADD VALUE 'CANCELADO';
ALTER TYPE "MessageStatus" ADD VALUE 'SIMULADO';
ALTER TYPE "MessageStatus" ADD VALUE 'CANCELADO';

DROP INDEX "leads_stage_idx";
DROP INDEX "lead_events_leadId_idx";

ALTER TABLE "courses" ADD COLUMN "category" TEXT,
ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "isLeadMagnet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "moodleCourseUrl" TEXT,
ADD COLUMN "officialCourseUrl" TEXT NOT NULL DEFAULT 'https://ra-training.com/courses-1/',
ADD COLUMN "price" DECIMAL(10,2),
ALTER COLUMN "isFree" SET DEFAULT false,
ALTER COLUMN "isPublished" SET DEFAULT false;

ALTER TABLE "leads" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "assignedToId" TEXT,
ADD COLUMN "consentAt" TIMESTAMP(3),
ADD COLUMN "consentPolicyVersion" TEXT,
ADD COLUMN "consentPurpose" TEXT,
ADD COLUMN "firstName" TEXT,
ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "landingUrl" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "lostReason" TEXT,
ADD COLUMN "nextActionAt" TIMESTAMP(3),
ADD COLUMN "referrer" TEXT;

ALTER TABLE "lead_events" ADD COLUMN "enrollmentId" TEXT,
ADD COLUMN "idempotencyKey" TEXT;

-- Add required timestamps in three safe stages for populated legacy tables.
ALTER TABLE "social_accounts" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "social_accounts" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "social_accounts" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "social_posts" ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "duplicatedFromId" TEXT,
ADD COLUMN "occurrenceKey" TEXT,
ADD COLUMN "publishStartedAt" TIMESTAMP(3),
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "scheduleId" TEXT;

ALTER TABLE "outbound_messages" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "enrollmentId" TEXT,
ADD COLUMN "isSimulation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "templateId" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "outbound_messages" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "outbound_messages" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'LECTURA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'INTERESADO',
    "source" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "landingUrl" TEXT,
    "moodleEnrollmentId" TEXT,
    "moodleCompletionDate" TIMESTAMP(3),
    "financeInscripcionId" TEXT,
    "financeStatus" "FinanceStatus" NOT NULL DEFAULT 'NO_ENVIADO',
    "certificateStatus" "CertificateStatus" NOT NULL DEFAULT 'DESCONOCIDO',
    "handoffAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastHandoffError" TEXT,
    "lastHandoffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_notes" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "type" "FollowUpType" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDIENTE',
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "result" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,
    "availableVariables" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_schedules" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "linkUrl" TEXT,
    "weekday" INTEGER NOT NULL,
    "localTime" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Guayaquil',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_schedules_pkey" PRIMARY KEY ("id")
);

-- Preserve the historical one-course relation as one Enrollment. A duplicate
-- legacy Finance reference remains on Lead and is intentionally not copied.
INSERT INTO "enrollments" (
    "id", "leadId", "courseId", "status", "source", "utmSource", "utmMedium",
    "utmCampaign", "financeInscripcionId", "financeStatus", "certificateStatus",
    "createdAt", "updatedAt"
)
SELECT
    'legacy_' || md5(l."id" || ':' || l."courseId"),
    l."id",
    l."courseId",
    CASE l."stage"
      WHEN 'INSCRITO' THEN 'INSCRITO'::"EnrollmentStatus"
      WHEN 'EN_CURSO' THEN 'EN_CURSO'::"EnrollmentStatus"
      WHEN 'CERTIFICADO' THEN 'COMPLETADO'::"EnrollmentStatus"
      ELSE 'INTERESADO'::"EnrollmentStatus"
    END,
    l."source",
    l."utmSource",
    l."utmMedium",
    l."utmCampaign",
    CASE WHEN l."financeInscripcionId" IS NOT NULL AND (
      SELECT count(*) FROM "leads" other
      WHERE other."financeInscripcionId" = l."financeInscripcionId"
    ) = 1 THEN l."financeInscripcionId" ELSE NULL END,
    CASE WHEN l."financeInscripcionId" IS NOT NULL THEN 'ENVIADO'::"FinanceStatus" ELSE 'NO_ENVIADO'::"FinanceStatus" END,
    CASE WHEN l."stage" = 'CERTIFICADO' THEN 'EMITIDO'::"CertificateStatus" ELSE 'DESCONOCIDO'::"CertificateStatus" END,
    l."createdAt",
    l."updatedAt"
FROM "leads" l
INNER JOIN "courses" c ON c."id" = l."courseId"
WHERE l."courseId" IS NOT NULL;

UPDATE "lead_events" event
SET "enrollmentId" = enrollment."id"
FROM "enrollments" enrollment
WHERE enrollment."leadId" = event."leadId"
  AND enrollment."courseId" = (SELECT lead."courseId" FROM "leads" lead WHERE lead."id" = event."leadId");

UPDATE "outbound_messages" message
SET "enrollmentId" = enrollment."id"
FROM "enrollments" enrollment
WHERE enrollment."leadId" = message."leadId"
  AND enrollment."courseId" = (SELECT lead."courseId" FROM "leads" lead WHERE lead."id" = message."leadId");

CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");
CREATE INDEX "admin_users_role_isActive_idx" ON "admin_users"("role", "isActive");
CREATE UNIQUE INDEX "enrollments_financeInscripcionId_key" ON "enrollments"("financeInscripcionId");
CREATE INDEX "enrollments_courseId_status_idx" ON "enrollments"("courseId", "status");
CREATE INDEX "enrollments_financeStatus_idx" ON "enrollments"("financeStatus");
CREATE UNIQUE INDEX "enrollments_leadId_courseId_key" ON "enrollments"("leadId", "courseId");
CREATE INDEX "lead_notes_leadId_createdAt_idx" ON "lead_notes"("leadId", "createdAt");
CREATE INDEX "follow_ups_status_dueAt_idx" ON "follow_ups"("status", "dueAt");
CREATE INDEX "follow_ups_leadId_idx" ON "follow_ups"("leadId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "message_templates_channel_isActive_idx" ON "message_templates"("channel", "isActive");
CREATE INDEX "social_schedules_isActive_nextRunAt_idx" ON "social_schedules"("isActive", "nextRunAt");
CREATE INDEX "courses_isPublished_displayOrder_idx" ON "courses"("isPublished", "displayOrder");
CREATE INDEX "courses_category_idx" ON "courses"("category");
CREATE INDEX "leads_stage_isArchived_idx" ON "leads"("stage", "isArchived");
CREATE INDEX "leads_phone_idx" ON "leads"("phone");
CREATE INDEX "leads_utmCampaign_idx" ON "leads"("utmCampaign");
CREATE INDEX "leads_assignedToId_idx" ON "leads"("assignedToId");
CREATE UNIQUE INDEX "lead_events_idempotencyKey_key" ON "lead_events"("idempotencyKey");
CREATE INDEX "lead_events_leadId_createdAt_idx" ON "lead_events"("leadId", "createdAt");
CREATE INDEX "lead_events_enrollmentId_idx" ON "lead_events"("enrollmentId");
CREATE INDEX "social_accounts_isActive_idx" ON "social_accounts"("isActive");
CREATE UNIQUE INDEX "social_posts_occurrenceKey_key" ON "social_posts"("occurrenceKey");
CREATE INDEX "social_posts_scheduleId_idx" ON "social_posts"("scheduleId");
CREATE INDEX "outbound_messages_enrollmentId_idx" ON "outbound_messages"("enrollmentId");
CREATE UNIQUE INDEX "outbound_messages_leadId_enrollmentId_sequenceKey_stepKey_key" ON "outbound_messages"("leadId", "enrollmentId", "sequenceKey", "stepKey");

ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "social_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_duplicatedFromId_fkey" FOREIGN KEY ("duplicatedFromId") REFERENCES "social_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_schedules" ADD CONSTRAINT "social_schedules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
