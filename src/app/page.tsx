import { seedCourses } from "@/data/courses";

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <span className="badge">Cursos gratuitos de enganche</span>
        <h1>Capacitate gratis y da tu primer paso profesional</h1>
        <p className="lead">
          En RA-Training creemos que la formacion abre puertas. Empieza hoy con
          uno de nuestros cursos gratuitos, 100% online y a tu ritmo.
        </p>
      </section>

      <section id="cursos">
        <h2>Nuestros cursos gratuitos</h2>
        <div className="course-list">
          {seedCourses.map((course) => (
            <a
              key={course.slug}
              className="course-card"
              href={`/cursos/${course.slug}`}
            >
              <span className="tag-free">GRATIS</span>
              <h3>{course.title}</h3>
              <p>{course.subtitle}</p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
