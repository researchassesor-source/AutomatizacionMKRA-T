import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { findCourseCaptureMappingByCrmSlug } from "@/data/course-capture-mapping";
import { LeadForm } from "./LeadForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const mapping = findCourseCaptureMappingByCrmSlug(slug);
  const course = mapping ? await prisma.course.findFirst({
    where: { slug, isPublished: true, acceptsRegistrations: true },
  }) : null;
  return course && mapping
    ? { title: mapping.title, description: course.description ?? course.subtitle ?? `Reserva tu cupo para ${mapping.title}.` }
    : { title: "Curso no encontrado" };
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mapping = findCourseCaptureMappingByCrmSlug(slug);
  if (!mapping) notFound();
  const course = await prisma.course.findFirst({
    where: { slug, isPublished: true, acceptsRegistrations: true },
  });
  if (!course) notFound();
  const benefits = Array.isArray(course.benefits) ? course.benefits.filter((item): item is string => typeof item === "string") : [];
  return (
    <main className="container course-landing">
      <div className="grid">
        <section>
          <span className="eyebrow">{mapping.category}</span>
          <h1>{mapping.title}</h1>
          <p className="lead">{course.description ?? course.subtitle ?? "Reserva tu cupo y nuestro equipo confirmará tu participación."}</p>
          {benefits.length > 0 && (
            <ul className="benefits">{benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>
          )}
          <div className="meta-row">
            <span>{mapping.duration}</span>
            <span>Registro de cupo gratuito</span>
          </div>
          <a className="text-link" href={mapping.officialCourseUrl}>Consultar información oficial ↗</a>
        </section>
        <LeadForm courseSlug={course.slug} course={mapping} />
      </div>
    </main>
  );
}
