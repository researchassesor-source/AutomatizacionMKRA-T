import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSeedCourse, seedCourses } from "@/data/courses";
import { LeadForm } from "./LeadForm";

export function generateStaticParams() {
  return seedCourses.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = getSeedCourse(slug);
  if (!course) return { title: "Curso no encontrado" };
  return {
    title: `${course.title} | RA-Training`,
    description: course.description,
  };
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = getSeedCourse(slug);
  if (!course) notFound();

  return (
    <main className="container">
      <section className="hero">
        <div className="grid">
          <div>
            <span className="badge">Curso gratuito</span>
            <h1>{course.title}</h1>
            <p className="lead">{course.description}</p>

            <ul className="benefits">
              {course.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>

            <div className="meta-row">
              <span>⏱ Duracion: {course.duration}</span>
              {course.hasCertificate && <span>🎓 Con certificado</span>}
            </div>
          </div>

          <LeadForm courseSlug={course.slug} />
        </div>
      </section>
    </main>
  );
}
