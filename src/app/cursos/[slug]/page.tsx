import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { LeadForm } from "./LeadForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const course = await prisma.course.findFirst({ where: { slug, isPublished: true } });
  return course
    ? { title: course.title, description: course.description ?? course.subtitle ?? undefined }
    : { title: "Curso no encontrado" };
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = await prisma.course.findFirst({ where: { slug, isPublished: true } });
  if (!course) notFound();
  const benefits = Array.isArray(course.benefits) ? course.benefits.filter((item): item is string => typeof item === "string") : [];
  return (
    <main className="container course-landing">
      <div className="grid">
        <section>
          <span className="eyebrow">{course.category ?? "Curso R.A. Training"}</span>
          <h1>{course.title}</h1>
          <p className="lead">{course.description ?? course.subtitle}</p>
          {benefits.length > 0 && (
            <ul className="benefits">{benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>
          )}
          <div className="meta-row">
            <span>{course.duration ?? "Duración por confirmar"}</span>
            <span>{course.isFree ? "Curso gratuito" : course.price ? `Inversión: $${course.price}` : "Precio por confirmar"}</span>
          </div>
          <a className="text-link" href={course.officialCourseUrl}>Consultar información oficial ↗</a>
        </section>
        <LeadForm courseSlug={course.slug} courseTitle={course.title} />
      </div>
    </main>
  );
}
