import { PrismaClient } from "@prisma/client";
import { seedCourses } from "../src/data/courses";

const prisma = new PrismaClient();

async function main() {
  for (const course of seedCourses) {
    await prisma.course.upsert({
      where: { slug: course.slug },
      update: {
        title: course.title,
        subtitle: course.subtitle,
        description: course.description,
        isFree: course.isFree,
        duration: course.duration,
        hasCertificate: course.hasCertificate,
        benefits: course.benefits,
      },
      create: {
        slug: course.slug,
        title: course.title,
        subtitle: course.subtitle,
        description: course.description,
        isFree: course.isFree,
        duration: course.duration,
        hasCertificate: course.hasCertificate,
        benefits: course.benefits,
      },
    });
    console.log(`  ✓ curso: ${course.slug}`);
  }
}

main()
  .then(() => console.log("Seed completado."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
