export const CRM_PUBLIC_URL = "https://automatizacion-mkra-t2.vercel.app";
export const OFFICIAL_SITE_URL = "https://ra-training.com/";
export const OFFICIAL_COURSE_CATALOG_URL = "https://ra-training.com/courses-1/";

export type CourseCaptureMapping = {
  officialCourseSlug: string | null;
  crmCourseSlug: string;
  officialCourseUrl: string;
  crmFormUrl: string;
  title: string;
  category: string;
  duration: string;
  modality: string | null;
  startDate: string | null;
  endDate: string | null;
  schedule: string | null;
  trainer: string | null;
  published: true;
  catalogVisible: true;
  hasOfficialPage: boolean;
  hasPrimaryCta: boolean;
  ctaVerified: boolean;
};

function crmFormUrl(slug: string) {
  return `${CRM_PUBLIC_URL}/cursos/${slug}`;
}

// Fuente verificada el 03-08-2026: catálogo público, páginas individuales y
// WordPress REST API de ra-training.com. Los valores ausentes se conservan en
// null para no inferir fechas, horarios, modalidad o capacitadores.
export const courseCaptureMappings = [
  {
    officialCourseSlug: "ia-para-apoyo-en-tareas-escolares",
    crmCourseSlug: "ia-apoyo-tareas-estudiantiles",
    officialCourseUrl: "https://ra-training.com/cursos/ia-para-apoyo-en-tareas-escolares/",
    crmFormUrl: crmFormUrl("ia-apoyo-tareas-estudiantiles"),
    title: "IA para Apoyo en Tareas Académicas",
    category: "IA para Educación",
    duration: "60 horas",
    modality: "Aulas virtuales",
    startDate: "4 de agosto",
    endDate: "6 de agosto",
    schedule: "Martes, Miércoles, Jueves 7:30-9:00 pm",
    trainer: "Mgs. Edison Bonifaz A.",
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: "ia-para-la-planificacion-educativa",
    crmCourseSlug: "ia-planificacion-educativa",
    officialCourseUrl: "https://ra-training.com/cursos/ia-para-la-planificacion-educativa/",
    crmFormUrl: crmFormUrl("ia-planificacion-educativa"),
    title: "IA para la Planificación Educativa",
    category: "IA para Educación",
    duration: "60 horas",
    modality: "Aulas virtuales",
    startDate: "18 de agosto",
    endDate: "20 de agosto",
    schedule: "Martes, Miércoles, Jueves, 7:00-9:00 pm",
    trainer: "Mgs. Edison Bonifaz A.",
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: "ia-para-la-planificacion-de-recursos-educativos",
    crmCourseSlug: "ia-planificacion-recursos-educativos",
    officialCourseUrl: "https://ra-training.com/cursos/ia-para-la-planificacion-de-recursos-educativos/",
    crmFormUrl: crmFormUrl("ia-planificacion-recursos-educativos"),
    title: "IA para la Planificación de Recursos Educativos",
    category: "IA para Educación",
    duration: "60 horas",
    modality: "Aulas virtuales",
    startDate: "25 de agosto",
    endDate: "27 de agosto",
    schedule: "Martes, Miércoles, Jueves 7:00-9:00 pm",
    trainer: "Mgs. Edison Bonifaz A.",
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: "comunicacion-estrategica-digital",
    crmCourseSlug: "comunicacion-estrategica-digital",
    officialCourseUrl: "https://ra-training.com/cursos/comunicacion-estrategica-digital/",
    crmFormUrl: crmFormUrl("comunicacion-estrategica-digital"),
    title: "Comunicación Estratégica Digital",
    category: "Gestión Pública y Ciudadanía",
    duration: "50 horas",
    modality: "Aulas virtuales",
    startDate: "17 de agosto",
    endDate: "19 de agosto",
    schedule: "Lunes, Martes y Miércoles 7:00-9:00 pm",
    trainer: "Mgs. Josué Cobo",
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: "procedimientos-parlamentarios",
    crmCourseSlug: "procedimientos-parlamentarios",
    officialCourseUrl: "https://ra-training.com/cursos/procedimientos-parlamentarios/",
    crmFormUrl: crmFormUrl("procedimientos-parlamentarios"),
    title: "Procedimientos Parlamentarios",
    category: "Gestión Pública y Ciudadanía",
    duration: "60 horas",
    modality: "Aulas virtuales",
    startDate: null,
    endDate: null,
    schedule: null,
    trainer: "Mgs. Josué Cobo",
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: "mecanismos-de-participacion-ciudadana-y-control-social",
    crmCourseSlug: "mecanismos-de-participacion-ciudadana-y-control-social",
    officialCourseUrl: "https://ra-training.com/cursos/mecanismos-de-participacion-ciudadana-y-control-social/",
    crmFormUrl: crmFormUrl("mecanismos-de-participacion-ciudadana-y-control-social"),
    title: "Mecanismos de Participación Ciudadana y Control Social",
    category: "Gestión Pública y Ciudadanía",
    duration: "40 horas",
    modality: "Aulas virtuales",
    startDate: null,
    endDate: null,
    schedule: null,
    trainer: "Mgs. Josué Cobo",
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: "habilidades-blandas-para-profesionales",
    crmCourseSlug: "habilidades-blandas-profesionales",
    officialCourseUrl: "https://ra-training.com/cursos/habilidades-blandas-para-profesionales/",
    crmFormUrl: crmFormUrl("habilidades-blandas-profesionales"),
    title: "Habilidades Blandas para Profesionales",
    category: "Redacción y Desarrollo Profesional",
    duration: "60 horas",
    modality: "Aulas virtuales",
    startDate: null,
    endDate: null,
    schedule: null,
    trainer: "Mgs. Josué Cobo",
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: "redaccion-y-elaboracion-de-oficios",
    crmCourseSlug: "redaccion-elaboracion-oficios",
    officialCourseUrl: "https://ra-training.com/cursos/redaccion-y-elaboracion-de-oficios/",
    crmFormUrl: crmFormUrl("redaccion-elaboracion-oficios"),
    title: "Redacción y Elaboración de Oficios",
    category: "Redacción y Desarrollo Profesional",
    duration: "40 horas",
    modality: "Aulas virtuales",
    startDate: null,
    endDate: null,
    schedule: null,
    trainer: "Mgs. Josué Cobo",
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: "ia-generativa-con-claude-nivel-basico",
    crmCourseSlug: "ia-generativa-claude-basico",
    officialCourseUrl: "https://ra-training.com/cursos/ia-generativa-con-claude-nivel-basico/",
    crmFormUrl: crmFormUrl("ia-generativa-claude-basico"),
    title: "IA Generativa con Claude (Nivel Básico)",
    category: "IA para Investigación",
    duration: "60 horas",
    modality: "Aulas virtuales",
    startDate: null,
    endDate: null,
    schedule: null,
    trainer: null,
    published: true,
    catalogVisible: true,
    hasOfficialPage: true,
    hasPrimaryCta: true,
    ctaVerified: false,
  },
  {
    officialCourseSlug: null,
    crmCourseSlug: "ia-desarrollo-tesis",
    officialCourseUrl: OFFICIAL_COURSE_CATALOG_URL,
    crmFormUrl: crmFormUrl("ia-desarrollo-tesis"),
    title: "IA aplicada al Desarrollo de Tesis",
    category: "IA para Investigación",
    duration: "60 horas",
    modality: null,
    startDate: null,
    endDate: null,
    schedule: null,
    trainer: null,
    published: true,
    catalogVisible: true,
    hasOfficialPage: false,
    hasPrimaryCta: false,
    ctaVerified: false,
  },
  {
    officialCourseSlug: null,
    crmCourseSlug: "ia-investigacion-contenido-marketing",
    officialCourseUrl: OFFICIAL_COURSE_CATALOG_URL,
    crmFormUrl: crmFormUrl("ia-investigacion-contenido-marketing"),
    title: "IA en Investigación: Generación de Contenido y Marketing",
    category: "IA para Investigación",
    duration: "60 horas",
    modality: null,
    startDate: null,
    endDate: null,
    schedule: null,
    trainer: null,
    published: true,
    catalogVisible: true,
    hasOfficialPage: false,
    hasPrimaryCta: false,
    ctaVerified: false,
  },
] as const satisfies readonly CourseCaptureMapping[];

export function findCourseCaptureMappingByCrmSlug(slug: string) {
  return courseCaptureMappings.find((course) => course.crmCourseSlug === slug) ?? null;
}

export function findCourseCaptureMappingByOfficialPath(pathname: string) {
  const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return courseCaptureMappings.find((course) => {
    if (!course.hasOfficialPage) return false;
    return new URL(course.officialCourseUrl).pathname === normalizedPath;
  }) ?? null;
}
