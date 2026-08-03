-- Captación de cursos: cambio aditivo, compatible con contactos históricos.
ALTER TABLE "courses"
ADD COLUMN "acceptsRegistrations" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "leads"
ADD COLUMN "utmContent" TEXT,
ADD COLUMN "utmTerm" TEXT;

ALTER TABLE "enrollments"
ADD COLUMN "utmContent" TEXT,
ADD COLUMN "utmTerm" TEXT,
ADD COLUMN "referrer" TEXT;

CREATE INDEX "leads_utmContent_idx" ON "leads"("utmContent");
CREATE INDEX "leads_utmTerm_idx" ON "leads"("utmTerm");

-- Dos páginas oficiales vigentes no tenían un curso CRM inequívoco. Se crean
-- con slugs propios en lugar de enlazarlas por similitud a registros antiguos.
INSERT INTO "courses" (
  "id", "slug", "title", "subtitle", "description", "category",
  "officialCourseUrl", "price", "duration", "modality", "isFree",
  "isPublished", "acceptsRegistrations", "isLeadMagnet", "hasCertificate",
  "displayOrder", "benefits", "createdAt", "updatedAt"
) VALUES
  (
    'campaign_202608_communication',
    'comunicacion-estrategica-digital',
    'Comunicación Estratégica Digital',
    NULL,
    NULL,
    'Gestión Pública y Ciudadanía',
    'https://ra-training.com/cursos/comunicacion-estrategica-digital/',
    0,
    '50 horas',
    'Virtual',
    true,
    true,
    true,
    true,
    true,
    40,
    '["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"]'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'campaign_202608_citizen_participation',
    'mecanismos-de-participacion-ciudadana-y-control-social',
    'Mecanismos de Participación Ciudadana y Control Social',
    NULL,
    NULL,
    'Gestión Pública y Ciudadanía',
    'https://ra-training.com/cursos/mecanismos-de-participacion-ciudadana-y-control-social/',
    0,
    '40 horas',
    'Virtual',
    true,
    true,
    true,
    true,
    true,
    60,
    '["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"]'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("slug") DO NOTHING;

-- Datos publicados y verificados. Los cursos históricos fuera del catálogo
-- conservan todos sus datos, pero no reciben acceptsRegistrations=true.
UPDATE "courses" AS course
SET
  "title" = official."title",
  "category" = official."category",
  "officialCourseUrl" = official."officialCourseUrl",
  "price" = official."price",
  "duration" = official."duration",
  "modality" = COALESCE(official."modality", course."modality"),
  "isFree" = official."isFree",
  "isPublished" = true,
  "acceptsRegistrations" = true,
  "isLeadMagnet" = official."isLeadMagnet",
  "hasCertificate" = true,
  "displayOrder" = official."displayOrder",
  "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
  ('ia-apoyo-tareas-estudiantiles', 'IA para Apoyo en Tareas Académicas', 'IA para Educación', 'https://ra-training.com/cursos/ia-para-apoyo-en-tareas-escolares/', 0::decimal, '60 horas', 'Virtual', true, true, 10),
  ('ia-planificacion-educativa', 'IA para la Planificación Educativa', 'IA para Educación', 'https://ra-training.com/cursos/ia-para-la-planificacion-educativa/', 0::decimal, '60 horas', 'Virtual', true, true, 20),
  ('ia-planificacion-recursos-educativos', 'IA para la Planificación de Recursos Educativos', 'IA para Educación', 'https://ra-training.com/cursos/ia-para-la-planificacion-de-recursos-educativos/', 0::decimal, '60 horas', 'Virtual', true, true, 30),
  ('comunicacion-estrategica-digital', 'Comunicación Estratégica Digital', 'Gestión Pública y Ciudadanía', 'https://ra-training.com/cursos/comunicacion-estrategica-digital/', 0::decimal, '50 horas', 'Virtual', true, true, 40),
  ('procedimientos-parlamentarios', 'Procedimientos Parlamentarios', 'Gestión Pública y Ciudadanía', 'https://ra-training.com/cursos/procedimientos-parlamentarios/', 0::decimal, '60 horas', 'Virtual', true, true, 50),
  ('mecanismos-de-participacion-ciudadana-y-control-social', 'Mecanismos de Participación Ciudadana y Control Social', 'Gestión Pública y Ciudadanía', 'https://ra-training.com/cursos/mecanismos-de-participacion-ciudadana-y-control-social/', 0::decimal, '40 horas', 'Virtual', true, true, 60),
  ('habilidades-blandas-profesionales', 'Habilidades Blandas para Profesionales', 'Redacción y Desarrollo Profesional', 'https://ra-training.com/cursos/habilidades-blandas-para-profesionales/', 0::decimal, '60 horas', 'Virtual', true, true, 70),
  ('redaccion-elaboracion-oficios', 'Redacción y Elaboración de Oficios', 'Redacción y Desarrollo Profesional', 'https://ra-training.com/cursos/redaccion-y-elaboracion-de-oficios/', 0::decimal, '40 horas', 'Virtual', true, true, 80),
  ('ia-generativa-claude-basico', 'IA Generativa con Claude (Nivel Básico)', 'IA para Investigación', 'https://ra-training.com/cursos/ia-generativa-con-claude-nivel-basico/', 30::decimal, '60 horas', 'Virtual', false, true, 90),
  ('ia-desarrollo-tesis', 'IA aplicada al Desarrollo de Tesis', 'IA para Investigación', 'https://ra-training.com/courses-1/', 30::decimal, '60 horas', NULL, false, false, 100),
  ('ia-investigacion-contenido-marketing', 'IA en Investigación: Generación de Contenido y Marketing', 'IA para Investigación', 'https://ra-training.com/courses-1/', 30::decimal, '60 horas', NULL, false, false, 110)
) AS official(
  "slug", "title", "category", "officialCourseUrl", "price", "duration",
  "modality", "isFree", "isLeadMagnet", "displayOrder"
)
WHERE course."slug" = official."slug";
