// Catalogo semilla de cursos gratuitos de enganche.
// En produccion esto vive en la base de datos (tabla courses);
// aqui sirve como fuente para el seed y como fallback de demostracion.

export type SeedCourse = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  isFree: boolean;
  duration: string;
  hasCertificate: boolean;
  benefits: string[];
};

export const seedCourses: SeedCourse[] = [
  {
    slug: "seguridad-y-salud-en-el-trabajo",
    title: "Introduccion a la Seguridad y Salud en el Trabajo",
    subtitle: "Curso gratuito de enganche - certificate en 3 horas",
    description:
      "Aprende los fundamentos del SG-SST y da tu primer paso en el mundo de la prevencion de riesgos laborales. Ideal para trabajadores, supervisores y quienes buscan una nueva oportunidad laboral.",
    isFree: true,
    duration: "3 horas",
    // Marcar en true SOLO cuando el aval del Ministerio de Trabajo este gestionado.
    hasCertificate: false,
    benefits: [
      "100% online y a tu ritmo",
      "Material descargable incluido",
      "Constancia de finalizacion",
      "Sin costo y sin letra pequena",
    ],
  },
  {
    slug: "excel-basico-para-el-trabajo",
    title: "Excel Basico para el Trabajo",
    subtitle: "De cero a productivo en una tarde",
    description:
      "Domina las formulas y funciones que todo puesto administrativo pide. Un curso practico y directo al grano para mejorar tu perfil laboral.",
    isFree: true,
    duration: "2 horas",
    hasCertificate: false,
    benefits: [
      "Ejercicios practicos reales",
      "Plantillas listas para usar",
      "Constancia de finalizacion",
      "Acceso inmediato",
    ],
  },
];

export function getSeedCourse(slug: string): SeedCourse | undefined {
  return seedCourses.find((c) => c.slug === slug);
}
