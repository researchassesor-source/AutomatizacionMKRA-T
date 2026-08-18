-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('AUTOMATION', 'HUMAN_HANDOFF', 'RESOLVED');

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'whatsapp_cloud',
    "fromPhone" TEXT NOT NULL,
    "toPhoneNumberId" TEXT,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "mediaMeta" JSONB,
    "contextMessageId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT,
    "enrollmentId" TEXT,
    "readAt" TIMESTAMP(3),
    "readByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "state" "ConversationState" NOT NULL DEFAULT 'AUTOMATION',
    "leadId" TEXT,
    "assignedToId" TEXT,
    "handoffAt" TIMESTAMP(3),
    "handoffBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_providerMessageId_key" ON "inbound_messages"("providerMessageId");

-- CreateIndex
CREATE INDEX "inbound_messages_fromPhone_occurredAt_idx" ON "inbound_messages"("fromPhone", "occurredAt");

-- CreateIndex
CREATE INDEX "inbound_messages_leadId_occurredAt_idx" ON "inbound_messages"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "inbound_messages_readAt_idx" ON "inbound_messages"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_phone_key" ON "conversations"("phone");

-- CreateIndex
CREATE INDEX "conversations_state_lastInboundAt_idx" ON "conversations"("state", "lastInboundAt");

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

