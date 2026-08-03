import {
  OFFICIAL_COURSE_CATALOG_URL,
  courseCaptureMappings,
} from "@/data/course-capture-mapping";

export const COURSE_CATALOG_URL =
  process.env.NEXT_PUBLIC_COURSE_CATALOG_URL ?? OFFICIAL_COURSE_CATALOG_URL;

export const MOODLE_BASE_URL = "https://moodle.ra-training.com";

export type SeedCourse = {
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  category: string;
  officialCourseUrl: string;
  price: number;
  duration: string;
  modality: string | null;
  isFree: boolean;
  isPublished: boolean;
  acceptsRegistrations: boolean;
  isLeadMagnet: boolean;
  hasCertificate: boolean;
  displayOrder: number;
  benefits: string[];
};

const catalogCommercialFacts: Record<string, {
  price: number;
  isFree: boolean;
  benefits: string[];
}> = {
  "ia-apoyo-tareas-estudiantiles": {
    price: 0,
    isFree: true,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "ia-planificacion-educativa": {
    price: 0,
    isFree: true,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "ia-planificacion-recursos-educativos": {
    price: 0,
    isFree: true,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "comunicacion-estrategica-digital": {
    price: 0,
    isFree: true,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "procedimientos-parlamentarios": {
    price: 0,
    isFree: true,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "mecanismos-de-participacion-ciudadana-y-control-social": {
    price: 0,
    isFree: true,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "habilidades-blandas-profesionales": {
    price: 0,
    isFree: true,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "redaccion-elaboracion-oficios": {
    price: 0,
    isFree: true,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "ia-generativa-claude-basico": {
    price: 30,
    isFree: false,
    benefits: ["Aulas virtuales", "Recursos", "Actividades", "Certificado avalado"],
  },
  "ia-desarrollo-tesis": { price: 30, isFree: false, benefits: [] },
  "ia-investigacion-contenido-marketing": { price: 30, isFree: false, benefits: [] },
};

// Snapshot normalizado del catálogo institucional verificado el 03-08-2026.
// La relación entre slug oficial y slug CRM vive únicamente en
// course-capture-mapping.ts; aquí se proyectan los campos persistidos.
export const seedCourses: SeedCourse[] = courseCaptureMappings.map((course, index) => {
  const commercial = catalogCommercialFacts[course.crmCourseSlug];
  if (!commercial) throw new Error(`Faltan datos comerciales verificados para ${course.crmCourseSlug}.`);
  return {
    slug: course.crmCourseSlug,
    title: course.title,
    subtitle: null,
    description: null,
    category: course.category,
    officialCourseUrl: course.officialCourseUrl,
    price: commercial.price,
    duration: course.duration,
    modality: course.modality === "Aulas virtuales" ? "Virtual" : course.modality,
    isFree: commercial.isFree,
    isPublished: course.published,
    acceptsRegistrations: true,
    isLeadMagnet: course.hasPrimaryCta,
    hasCertificate: true,
    displayOrder: (index + 1) * 10,
    benefits: commercial.benefits,
  };
});
