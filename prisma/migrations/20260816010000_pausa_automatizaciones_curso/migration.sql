-- Pausa de automatizaciones por curso.
--
-- Migracion ADITIVA: dos columnas nuevas que admiten NULL. Las filas existentes
-- quedan validas sin tocarlas, y NULL significa "no pausado", que es el
-- comportamiento actual. Sin DROP, sin TRUNCATE, sin renombrados.
ALTER TABLE "courses" ADD COLUMN "automationsPausedAt" TIMESTAMP(3);
ALTER TABLE "courses" ADD COLUMN "automationsPausedBy" TEXT;
