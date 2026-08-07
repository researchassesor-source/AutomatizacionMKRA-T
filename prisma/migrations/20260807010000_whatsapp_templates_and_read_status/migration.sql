-- Soporte de plantillas de WhatsApp y estado LEIDO.
--
-- Migracion estrictamente aditiva: un valor nuevo de enum y cuatro columnas
-- opcionales. Ninguna fila existente cambia, ninguna columna se elimina y el
-- codigo anterior sigue funcionando sin tocar nada (las reglas de correo dejan
-- las columnas nuevas en NULL).
--
-- Nota sobre el enum: PostgreSQL 12+ admite ALTER TYPE ... ADD VALUE dentro de
-- una transaccion siempre que el valor nuevo no se USE en la misma
-- transaccion. Aqui solo se declara, asi que es seguro.
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'LEIDO';

ALTER TABLE "outbound_messages" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);
ALTER TABLE "outbound_messages" ADD COLUMN IF NOT EXISTS "waTemplate" JSONB;

ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "waTemplateName" TEXT;
ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "waTemplateLanguage" TEXT;
ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "waTemplateBodyVars" JSONB;
ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "waTemplateUrlVar" TEXT;

-- El plan estandar pasa a existir en dos canales. La clave (curso, planKey)
-- impedia que un mismo curso tuviera la bienvenida por correo y por WhatsApp,
-- porque ambas son el mismo paso del plan. El canal entra en la identidad.
--
-- El cambio no puede perder datos: hoy solo las reglas de correo tienen
-- planKey y las de WhatsApp lo tienen a NULL, asi que las filas actuales ya
-- cumplen la clave nueva. Si alguna no la cumpliera, la creacion del indice
-- fallaria y la migracion se detendria en lugar de borrar nada.
DROP INDEX IF EXISTS "automation_rules_courseId_planKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "automation_rules_courseId_channel_planKey_key"
  ON "automation_rules" ("courseId", "channel", "planKey");
