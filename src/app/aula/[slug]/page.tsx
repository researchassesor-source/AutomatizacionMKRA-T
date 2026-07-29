import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AulaRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = await prisma.course.findFirst({ where: { slug, isPublished: true } });
  if (!course) notFound();
  if (course.moodleCourseUrl) redirect(course.moodleCourseUrl);
  return (
    <main className="container center-narrow">
      <div className="card">
        <span className="eyebrow">Campus virtual</span>
        <h1>Acceso pendiente de configuración</h1>
        <p>El enlace del campus para “{course.title}” todavía no está disponible en el CRM.</p>
        <a className="btn btn-inline" href={course.officialCourseUrl}>Ver información oficial</a>
      </div>
    </main>
  );
}
