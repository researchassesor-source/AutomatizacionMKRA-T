import {
  OFFICIAL_COURSE_CATALOG_URL,
  OFFICIAL_SITE_URL,
  findCourseCaptureMappingByCrmSlug,
} from "@/data/course-capture-mapping";

export default async function GraciasPage({
  searchParams,
}: {
  searchParams: Promise<{ curso?: string; actualizado?: string }>;
}) {
  const { curso, actualizado } = await searchParams;
  const course = curso ? findCourseCaptureMappingByCrmSlug(curso) : null;
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "");
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent("Hola, necesito ayuda con mi registro a un curso de R.A. Training.")}`
    : null;

  return (
    <main className="container confirmation-page">
      <div className="center-narrow confirmation-card">
        <span className="badge">¡Registro recibido!</span>
        <h1>¡Registro recibido!</h1>
        <p className="lead">
          {actualizado === "1"
            ? "Ya teníamos registrado tu interés en este curso. Actualizamos tus datos correctamente."
            : "Guardamos correctamente tu información para el curso. Nuestro equipo se pondrá en contacto contigo por WhatsApp o correo electrónico."}
        </p>
        {course ? <p className="confirmation-course">Curso: <strong>{course.title}</strong></p> : null}
        <div className="confirmation-actions">
          <a className="btn" href={OFFICIAL_COURSE_CATALOG_URL}>Ver más cursos</a>
          <a className="btn ghost" href={OFFICIAL_SITE_URL}>Volver a R.A. Training</a>
        </div>
        {course?.hasOfficialPage ? <a className="text-link" href={course.officialCourseUrl}>Ver información oficial del curso ↗</a> : null}
        {whatsappUrl ? <a className="confirmation-help" href={whatsappUrl} target="_blank" rel="noopener noreferrer">¿Necesitas ayuda? Escríbenos por WhatsApp.</a> : null}
      </div>
    </main>
  );
}
