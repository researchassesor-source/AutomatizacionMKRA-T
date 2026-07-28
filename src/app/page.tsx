import { prisma } from "@/lib/db";
import { COURSE_CATALOG_URL } from "@/data/courses";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const courses = await prisma.course.findMany({
    where: { isPublished: true },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });
  return (
    <main>
      <section className="public-hero">
        <div className="container public-hero-grid">
          <div>
            <span className="eyebrow">Formación profesional</span>
            <h1>Conecta con el curso que impulsa tu siguiente paso</h1>
            <p>
              Registra tu interés y recibe acompañamiento de R.A. Training. El catálogo,
              el campus y los certificados mantienen responsabilidades separadas y seguras.
            </p>
            <a className="btn btn-inline" href={COURSE_CATALOG_URL}>Ver catálogo oficial</a>
          </div>
          <section className="hero-panel" aria-label="Proceso de inscripción">
            <span>01 · Explora</span>
            <strong>Elige tu curso en el catálogo oficial</strong>
            <span>02 · Registra</span>
            <strong>Déjanos tus datos para acompañarte</strong>
            <span>03 · Aprende</span>
            <strong>Continúa en el campus virtual</strong>
          </section>
        </div>
      </section>
      <section className="container section" id="cursos">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Oferta vigente</span>
            <h2>Cursos de R.A. Training</h2>
          </div>
          <a href={COURSE_CATALOG_URL}>Abrir catálogo completo ↗</a>
        </div>
        <div className="course-list">
          {courses.map((course) => (
            <article className="course-card" key={course.id}>
              <span className="pill info">{course.category ?? "Formación profesional"}</span>
              <h3>{course.title}</h3>
              <p>{course.subtitle ?? course.description}</p>
              <div className="course-meta">
                <span>{course.duration ?? "Duración por confirmar"}</span>
                <span>{course.isFree ? "Gratuito" : course.price ? `$${course.price}` : "Consultar"}</span>
              </div>
              <div className="card-actions">
                <a className="btn-sm" href={`/cursos/${course.slug}`}>Me interesa</a>
                <a className="btn-sm ghost" href={course.officialCourseUrl}>Información oficial ↗</a>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
