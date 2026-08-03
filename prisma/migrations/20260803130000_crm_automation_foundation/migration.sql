-- CRM automation foundation for isolated Preview environments.
-- Additive only: no table, column, relation, or historical record is removed.

CREATE TYPE "LeadClassification" AS ENUM ('REAL', 'TEST', 'DEMO', 'UNKNOWN');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "AutomationTrigger" AS ENUM ('ON_REGISTRATION', 'BEFORE_COURSE', 'AFTER_COURSE');
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "CatalogSyncStatus" AS ENUM ('NEVER_SYNCED', 'SYNCED', 'CONFLICT', 'ERROR');
CREATE TYPE "SocialConnectionStatus" AS ENUM ('UNKNOWN', 'SIMULATION', 'READY', 'EXPIRED', 'DISCONNECTED', 'MISSING_PERMISSION', 'ERROR');

ALTER TYPE "MessageStatus" ADD VALUE 'ACEPTADO';
ALTER TYPE "MessageStatus" ADD VALUE 'ENTREGADO';
ALTER TYPE "MessageStatus" ADD VALUE 'REBOTADO';

ALTER TYPE "PostStatus" ADD VALUE 'ARCHIVADO';
ALTER TYPE "PostStatus" ADD VALUE 'ELIMINADO_LOCAL';
ALTER TYPE "PostStatus" ADD VALUE 'ELIMINADO_PROVEEDOR';
ALTER TYPE "PostStatus" ADD VALUE 'ACEPTADO';

ALTER TABLE "leads"
ADD COLUMN "classification" "LeadClassification" NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE "courses"
ADD COLUMN "externalId" TEXT,
ADD COLUMN "externalSource" TEXT,
ADD COLUMN "officialSlug" TEXT,
ADD COLUMN "crmSlug" TEXT,
ADD COLUMN "officialUrl" TEXT,
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3),
ADD COLUMN "syncStatus" "CatalogSyncStatus" NOT NULL DEFAULT 'NEVER_SYNCED',
ADD COLUMN "syncError" TEXT;

ALTER TABLE "enrollments"
ADD COLUMN "campaignId" TEXT;

ALTER TABLE "outbound_messages"
ADD COLUMN "acceptedAt" TIMESTAMP(3),
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "bouncedAt" TIMESTAMP(3),
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "errorCode" TEXT,
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "providerName" TEXT,
ADD COLUMN "providerMessageId" TEXT,
ADD COLUMN "providerResponse" JSONB,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN "automationRuleId" TEXT;

ALTER TABLE "social_accounts"
ADD COLUMN "connectionStatus" "SocialConnectionStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "connectionCheckedAt" TIMESTAMP(3),
ADD COLUMN "connectionError" TEXT,
ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);

ALTER TABLE "social_posts"
ADD COLUMN "providerPostUrl" TEXT,
ADD COLUMN "providerResponse" JSONB,
ADD COLUMN "errorCode" TEXT,
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "deletedLocallyAt" TIMESTAMP(3),
ADD COLUMN "providerDeletedAt" TIMESTAMP(3);

CREATE TABLE "campaigns" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "courseId" TEXT,
  "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "source" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_rules" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "campaignId" TEXT,
  "name" TEXT NOT NULL,
  "trigger" "AutomationTrigger" NOT NULL,
  "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
  "channel" "MessageChannel" NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
  "enrollmentStatuses" JSONB,
  "lastExecutedAt" TIMESTAMP(3),
  "nextExecutionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "message_provider_events" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT,
  "type" TEXT NOT NULL,
  "payload" JSONB,
  "occurredAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "catalog_sync_runs" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" "CatalogSyncStatus" NOT NULL DEFAULT 'NEVER_SYNCED',
  "discovered" INTEGER NOT NULL DEFAULT 0,
  "created" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0,
  "conflicts" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "catalog_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rate_limit_buckets" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- Preview starts with editable rules. External delivery remains forced to
-- SIMULATED by the runtime for every Vercel Preview deployment.
INSERT INTO "automation_rules" (
  "id", "courseId", "name", "trigger", "offsetMinutes", "channel",
  "subject", "body", "status", "enrollmentStatuses", "createdAt", "updatedAt"
)
SELECT
  'auto_' || md5(course."id" || ':' || defaults.suffix),
  course."id",
  defaults.name,
  defaults.trigger::"AutomationTrigger",
  defaults.offset_minutes,
  defaults.channel::"MessageChannel",
  defaults.subject,
  defaults.body,
  defaults.status::"AutomationStatus",
  '["INTERESADO","INSCRITO"]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "courses" course
CROSS JOIN (VALUES
  ('registration_email', 'Confirmación inmediata · correo', 'ON_REGISTRATION', 0, 'EMAIL', 'Tu registro en {{curso}}', 'Hola {{nombre}}, tu cupo para {{curso}} fue registrado. Fecha: {{fecha}}. Hora: {{hora}}. Modalidad: {{modalidad}}. Información: {{enlace}}', 'ACTIVE'),
  ('registration_whatsapp', 'Confirmación inmediata · WhatsApp', 'ON_REGISTRATION', 0, 'WHATSAPP', NULL, 'Hola {{nombre}}. Tu cupo para {{curso}} fue registrado. Fecha: {{fecha}}, hora: {{hora}}, modalidad: {{modalidad}}. Información: {{enlace}}', 'ACTIVE'),
  ('before_24h_email', '24 horas antes · correo', 'BEFORE_COURSE', 1440, 'EMAIL', 'Mañana comienza {{curso}}', 'Hola {{nombre}}. Te recordamos que {{curso}} comienza el {{fecha}} a las {{hora}}. Modalidad: {{modalidad}}. Acceso: {{enlace}}', 'ACTIVE'),
  ('before_24h_whatsapp', '24 horas antes · WhatsApp', 'BEFORE_COURSE', 1440, 'WHATSAPP', NULL, 'Hola {{nombre}}. Mañana comienza {{curso}} a las {{hora}}. Modalidad: {{modalidad}}. Acceso: {{enlace}}', 'ACTIVE'),
  ('before_2h_email', '2 horas antes · correo', 'BEFORE_COURSE', 120, 'EMAIL', 'En 2 horas comienza {{curso}}', 'Hola {{nombre}}. {{curso}} comienza en 2 horas. Acceso: {{enlace}}', 'ACTIVE'),
  ('before_2h_whatsapp', '2 horas antes · WhatsApp', 'BEFORE_COURSE', 120, 'WHATSAPP', NULL, 'Hola {{nombre}}. {{curso}} comienza en 2 horas. Acceso: {{enlace}}', 'ACTIVE'),
  ('after_email', 'Agradecimiento posterior · correo', 'AFTER_COURSE', 60, 'EMAIL', 'Gracias por participar en {{curso}}', 'Hola {{nombre}}. Gracias por participar en {{curso}}. Esperamos que la experiencia haya sido útil.', 'DRAFT')
) AS defaults(suffix, name, trigger, offset_minutes, channel, subject, body, status)
WHERE course."isPublished" = true;

CREATE INDEX "leads_classification_isArchived_idx" ON "leads"("classification", "isArchived");
CREATE UNIQUE INDEX "courses_crmSlug_key" ON "courses"("crmSlug");
CREATE UNIQUE INDEX "courses_externalSource_externalId_key" ON "courses"("externalSource", "externalId");
CREATE INDEX "courses_syncStatus_idx" ON "courses"("syncStatus");
CREATE UNIQUE INDEX "campaigns_code_key" ON "campaigns"("code");
CREATE INDEX "campaigns_status_startsAt_idx" ON "campaigns"("status", "startsAt");
CREATE INDEX "campaigns_courseId_idx" ON "campaigns"("courseId");
CREATE INDEX "enrollments_campaignId_idx" ON "enrollments"("campaignId");
CREATE INDEX "automation_rules_status_nextExecutionAt_idx" ON "automation_rules"("status", "nextExecutionAt");
CREATE INDEX "automation_rules_courseId_trigger_idx" ON "automation_rules"("courseId", "trigger");
CREATE INDEX "automation_rules_campaignId_idx" ON "automation_rules"("campaignId");
CREATE INDEX "outbound_messages_automationRuleId_idx" ON "outbound_messages"("automationRuleId");
CREATE INDEX "outbound_messages_providerMessageId_idx" ON "outbound_messages"("providerMessageId");
CREATE UNIQUE INDEX "message_provider_events_provider_providerEventId_key" ON "message_provider_events"("provider", "providerEventId");
CREATE INDEX "message_provider_events_messageId_receivedAt_idx" ON "message_provider_events"("messageId", "receivedAt");
CREATE INDEX "catalog_sync_runs_source_startedAt_idx" ON "catalog_sync_runs"("source", "startedAt");
CREATE INDEX "rate_limit_buckets_resetAt_idx" ON "rate_limit_buckets"("resetAt");

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_automationRuleId_fkey"
FOREIGN KEY ("automationRuleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_provider_events" ADD CONSTRAINT "message_provider_events_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "outbound_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
