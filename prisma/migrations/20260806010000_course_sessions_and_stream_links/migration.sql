-- Sesiones de curso, enlace de transmision configurable y trazabilidad por
-- sesion en los mensajes automaticos.
--
-- Aditiva y reversible: no elimina tablas, columnas, relaciones ni registros.
-- Los cursos existentes conservan `startsAt`/`endsAt` y siguen funcionando como
-- una sesion unica virtual mientras no se registren sesiones reales.
--
-- Reversion (ver docs/ROLLBACK.md):
--   DROP TABLE "course_sessions";
--   ALTER TABLE "outbound_messages" DROP COLUMN "courseSessionId";
--   ALTER TABLE "automation_rules" DROP COLUMN "requiresStreamUrl", DROP COLUMN "planKey";
--   ALTER TABLE "courses" DROP COLUMN "streamUrl";

-- Enlace de transmision por defecto del curso. Configurable desde el CRM, nunca
-- fijado en el codigo. Puede quedar vacio en la creacion inicial.
ALTER TABLE "courses"
ADD COLUMN IF NOT EXISTS "streamUrl" TEXT;

CREATE TABLE IF NOT EXISTS "course_sessions" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "streamUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Guayaquil',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "course_sessions_courseId_startAt_idx" ON "course_sessions"("courseId", "startAt");
CREATE INDEX IF NOT EXISTS "course_sessions_startAt_idx" ON "course_sessions"("startAt");

DO $$
BEGIN
    ALTER TABLE "course_sessions"
    ADD CONSTRAINT "course_sessions_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Trazabilidad: cada recordatorio queda ligado a la sesion que lo origino.
ALTER TABLE "outbound_messages"
ADD COLUMN IF NOT EXISTS "courseSessionId" TEXT;

CREATE INDEX IF NOT EXISTS "outbound_messages_courseSessionId_idx" ON "outbound_messages"("courseSessionId");

DO $$
BEGIN
    ALTER TABLE "outbound_messages"
    ADD CONSTRAINT "outbound_messages_courseSessionId_fkey"
    FOREIGN KEY ("courseSessionId") REFERENCES "course_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Reglas que solo tienen sentido con enlace de transmision (recordatorio de 15
-- minutos) y clave del plan estandar de correos para poder reaplicarlo sin
-- duplicar reglas.
ALTER TABLE "automation_rules"
ADD COLUMN IF NOT EXISTS "requiresStreamUrl" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "planKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "automation_rules_courseId_planKey_key" ON "automation_rules"("courseId", "planKey");
