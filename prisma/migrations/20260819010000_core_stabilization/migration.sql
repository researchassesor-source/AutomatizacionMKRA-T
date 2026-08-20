-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "financeServiceId" TEXT;

-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "activatedAt" TIMESTAMP(3);

-- Backfill: reglas ya ACTIVE (o cualquier otro estado) reciben createdAt como
-- activatedAt conservador. Para una regla ACTIVE esto reproduce exactamente
-- el comportamiento anterior del guard de bienvenida (que comparaba contra
-- createdAt), asi que ningun inscrito existente empieza a recibir -ni deja de
-- recibir- una bienvenida retroactiva por aplicar esta migracion.
UPDATE "automation_rules" SET "activatedAt" = "createdAt" WHERE "activatedAt" IS NULL;

-- Reconciliacion derivada persistente (curso): startsAt/endsAt, cola,
-- nextExecutionAt de reglas fijas y oferta #12. NULL = reconciliado; no hace
-- falta backfill porque ningun curso existente puede estar "pendiente" de
-- una mecanica que hasta ahora no existia.
-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "automationReconcilePendingAt" TIMESTAMP(3);
ALTER TABLE "courses" ADD COLUMN     "automationReconcileReason" TEXT;

-- CreateIndex
CREATE INDEX "courses_automationReconcilePendingAt_idx" ON "courses"("automationReconcilePendingAt");
