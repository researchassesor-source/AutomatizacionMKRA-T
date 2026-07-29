import Link from "next/link";

export default async function GraciasPage({
  searchParams,
}: {
  searchParams: Promise<{ curso?: string }>;
}) {
  const { curso } = await searchParams;

  return (
    <main className="container">
      <div className="center-narrow">
        <span className="badge">Interés registrado</span>
        <h1>¡Gracias por contactarnos!</h1>
        <p className="lead" style={{ margin: "12px auto" }}>
          El equipo de R.A. Training revisará tu solicitud y te contactará para
          explicar disponibilidad, inscripción y siguientes pasos.
        </p>
        {curso && (
          <Link
            className="btn"
            href={`/cursos/${curso}`}
            style={{ maxWidth: 300, margin: "20px auto 8px" }}
          >
            Ver información del curso
          </Link>
        )}
        <Link
          href="/"
          style={{ display: "inline-block", marginTop: 8, fontWeight: 600 }}
        >
          Ver más cursos
        </Link>
      </div>
    </main>
  );
}
