-- Campos descriptivos faltantes del catálogo. Cambio aditivo y nullable para
-- preservar cursos históricos y permitir un despliegue gradual.
ALTER TABLE "courses"
ADD COLUMN "modality" TEXT,
ADD COLUMN "startsAt" TIMESTAMP(3),
ADD COLUMN "endsAt" TIMESTAMP(3);
