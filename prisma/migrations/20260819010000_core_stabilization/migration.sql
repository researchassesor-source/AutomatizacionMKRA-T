-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "financeServiceId" TEXT;

-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "activatedAt" TIMESTAMP(3);

-- Backfill: SOLO reglas ACTIVE reciben activatedAt, y a partir de updatedAt
-- (no createdAt). El guard de bienvenida en Production hoy compara contra
-- rule.updatedAt (enrollment.createdAt < rule.updatedAt), no contra
-- createdAt. Backfillear con createdAt movería la frontera hacia atrás para
-- cualquier regla editada o activada despues de creada (updatedAt >
-- createdAt), y una inscripcion registrada en ese hueco -antes de updatedAt
-- pero despues de createdAt- pasaria de estar correctamente excluida a
-- calificar para una bienvenida retroactiva que Production nunca le habria
-- mandado. DRAFT/PAUSED/ARCHIVED quedan en NULL: el guard solo se evalua
-- para reglas ACTIVE, y el motor ya usa updatedAt como frontera de reserva
-- si activatedAt faltara por cualquier motivo.
UPDATE "automation_rules" SET "activatedAt" = "updatedAt" WHERE "activatedAt" IS NULL AND "status" = 'ACTIVE';

-- Reconciliacion derivada persistente (curso): startsAt/endsAt, cola,
-- nextExecutionAt de reglas fijas y oferta #12. NULL = reconciliado; no hace
-- falta backfill porque ningun curso existente puede estar "pendiente" de
-- una mecanica que hasta ahora no existia.
-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "automationReconcilePendingAt" TIMESTAMP(3);
ALTER TABLE "courses" ADD COLUMN     "automationReconcileReason" TEXT;

-- CreateIndex
CREATE INDEX "courses_automationReconcilePendingAt_idx" ON "courses"("automationReconcilePendingAt");
