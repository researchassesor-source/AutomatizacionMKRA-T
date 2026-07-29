export const COURSE_CATALOG_URL =
  process.env.NEXT_PUBLIC_COURSE_CATALOG_URL ?? "https://ra-training.com/courses-1/";

export const MOODLE_BASE_URL = "https://moodle.ra-training.com";

export type SeedCourse = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  officialCourseUrl: string;
  price: number;
  duration: string;
  modality: string;
  isFree: boolean;
  isPublished: boolean;
  isLeadMagnet: boolean;
  hasCertificate: boolean;
  displayOrder: number;
  benefits: string[];
};

// Catálogo comprobado en la página institucional el 29-07-2026. Cuando no
// existe una pagina individual confirmada se conserva el catalogo como destino.
export const seedCourses: SeedCourse[] = [
  {
    slug: "ia-apoyo-tareas-estudiantiles",
    title: "IA para Apoyo en Tareas Académicas",
    subtitle: "Uso responsable de IA en actividades académicas",
    description: "Curso institucional gratuito para aplicar inteligencia artificial como apoyo en tareas académicas.",
    category: "IA para Educación",
    officialCourseUrl: "https://ra-training.com/cursos/ia-para-apoyo-en-tareas-escolares/",
    price: 0,
    duration: "60 horas",
    modality: "Virtual",
    isFree: true,
    isPublished: true,
    isLeadMagnet: true,
    hasCertificate: true,
    displayOrder: 10,
    benefits: ["Modalidad virtual", "Aplicación práctica", "Certificado verificable"],
  },
  {
    slug: "ia-planificacion-recursos-educativos",
    title: "IA para la Planificación de Recursos Educativos",
    subtitle: "Formación virtual aplicada a la gestión educativa",
    description: "Curso institucional de inteligencia artificial aplicada a la planificación de recursos educativos.",
    category: "IA para Educación",
    officialCourseUrl: "https://ra-training.com/cursos/ia-para-la-planificacion-de-recursos-educativos/",
    price: 20,
    duration: "60 horas",
    modality: "Virtual",
    isFree: false,
    isPublished: true,
    isLeadMagnet: false,
    hasCertificate: true,
    displayOrder: 20,
    benefits: ["Modalidad virtual", "Acompañamiento profesional", "Certificado verificable"],
  },
  {
    slug: "ia-planificacion-educativa",
    title: "IA para la Planificación Educativa",
    subtitle: "Herramientas de IA para el trabajo docente",
    description: "Curso institucional para incorporar inteligencia artificial en la planificación educativa.",
    category: "IA para Educación",
    officialCourseUrl: "https://ra-training.com/cursos/ia-para-la-planificacion-educativa/",
    price: 20,
    duration: "60 horas",
    modality: "Virtual",
    isFree: false,
    isPublished: true,
    isLeadMagnet: false,
    hasCertificate: true,
    displayOrder: 30,
    benefits: ["Modalidad virtual", "Recursos aplicables", "Certificado verificable"],
  },
  ...[
    ["ia-generativa-claude-basico", "IA Generativa con Claude (Nivel Básico)", "IA para Investigación", 40],
    ["ia-desarrollo-tesis", "IA aplicada al Desarrollo de Tesis", "IA para Investigación", 50],
    ["ia-investigacion-contenido-marketing", "IA en Investigación: Generación de Contenido y Marketing", "IA para Investigación", 60],
    ["equipos-ganan-elecciones", "Equipos que Ganan Elecciones", "Gestión Pública y Ciudadanía", 70],
    ["procedimientos-parlamentarios", "Procedimientos Parlamentarios para Organizaciones Sociales", "Gestión Pública y Ciudadanía", 80],
    ["comunicacion-estrategica-organizacional", "Comunicación Estratégica Organizacional en Entornos Digitales", "Gestión Pública y Ciudadanía", 90],
    ["redaccion-elaboracion-oficios", "Redacción y Elaboración de Oficios", "Redacción y Desarrollo Profesional", 100],
    ["habilidades-blandas-profesionales", "Habilidades Blandas para Profesionales", "Redacción y Desarrollo Profesional", 110],
  ].map(([slug, title, category, displayOrder]) => ({
    slug: String(slug),
    title: String(title),
    subtitle: "Formación profesional de R.A. Training",
    description: `Curso institucional: ${String(title)}.`,
    category: String(category),
    officialCourseUrl: COURSE_CATALOG_URL,
    price: 30,
    duration: "60 horas",
    modality: "Virtual",
    isFree: false,
    isPublished: true,
    isLeadMagnet: false,
    hasCertificate: true,
    displayOrder: Number(displayOrder),
    benefits: ["Modalidad virtual", "Contenido especializado", "Certificado verificable"],
  })),
];
