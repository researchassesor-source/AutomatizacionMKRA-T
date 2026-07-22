import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSeedCourse, seedCourses } from "@/data/courses";
import { CompleteWidget } from "./CompleteWidget";

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
  return { title: course ? `Aula · ${course.title}` : "Aula" };
}

export default async function AulaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = getSeedCourse(slug);
  if (!course) notFound();

  return (
    <main className="container" style={{ paddingTop: 32, paddingBottom: 60 }}>
      <span className="badge">Aula virtual</span>
      <h1 style={{ marginTop: 8 }}>{course.title}</h1>
      <p className="muted">Avanza por las lecciones y al terminar obten tu certificado.</p>

      <div style={{ marginTop: 24 }}>
        {course.lessons.map((lesson, i) => (
          <div className="panel" key={i}>
            <h2 style={{ marginBottom: 8 }}>
              Leccion {i + 1}: {lesson.title}
            </h2>
            <p style={{ margin: 0 }}>{lesson.content}</p>
          </div>
        ))}
      </div>

      <CompleteWidget courseSlug={course.slug} />
    </main>
  );
}
