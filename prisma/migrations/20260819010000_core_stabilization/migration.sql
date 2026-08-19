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
