import { PrismaClient } from "@prisma/client";
import { seedCourses } from "../src/data/courses";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("El seed está deshabilitado en Producción.");
  }
  for (const course of seedCourses) {
    await prisma.course.upsert({
      where: { slug: course.slug },
      update: course,
      create: course,
    });
  }
}

main()
  .then(() => console.log("Catálogo institucional actualizado."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo actualizar el catálogo.");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
