// Catalogo semilla de cursos gratuitos de enganche.
// En produccion esto vive en la base de datos (tabla courses);
// aqui sirve como fuente para el seed y como fallback de demostracion.

export type Lesson = {
  title: string;
  content: string;
};

export type SeedCourse = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  isFree: boolean;
  duration: string;
  hasCertificate: boolean;
  benefits: string[];
  lessons: Lesson[];
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
    lessons: [
      {
        title: "¿Que es la Seguridad y Salud en el Trabajo?",
        content:
          "La SST es la disciplina que busca prevenir las lesiones y enfermedades causadas por las condiciones de trabajo. Protege y promueve la salud de los trabajadores mediante el control de los riesgos en el lugar de trabajo.",
      },
      {
        title: "Identificacion de peligros y riesgos",
        content:
          "Un peligro es una fuente con potencial de causar dano; el riesgo es la probabilidad de que ese dano ocurra. Aprender a identificarlos es el primer paso para prevenir accidentes.",
      },
      {
        title: "Elementos de proteccion personal (EPP)",
        content:
          "Los EPP son la ultima barrera de proteccion frente a los riesgos. Casco, guantes, calzado y proteccion visual o auditiva deben usarse segun cada tarea.",
      },
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
    lessons: [
      {
        title: "La interfaz de Excel",
        content:
          "Conoce la cinta de opciones, las celdas, filas y columnas. Aprende a moverte con rapidez por una hoja de calculo y a guardar tu trabajo.",
      },
      {
        title: "Formulas basicas",
        content:
          "SUMA, PROMEDIO, MAX y MIN son las funciones que resuelven el 80% de las tareas diarias. Practica combinandolas con rangos de celdas.",
      },
      {
        title: "Formato y presentacion",
        content:
          "Un dato bien presentado comunica mejor. Aplica formato de numero, moneda y porcentaje, y resalta lo importante con formato condicional.",
      },
    ],
  },
];

export function getSeedCourse(slug: string): SeedCourse | undefined {
  return seedCourses.find((c) => c.slug === slug);
}
