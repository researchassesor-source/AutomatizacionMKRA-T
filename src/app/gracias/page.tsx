export default async function GraciasPage({
  searchParams,
}: {
  searchParams: Promise<{ curso?: string }>;
}) {
  const { curso } = await searchParams;

  return (
    <main className="container">
      <div className="center-narrow">
        <span className="badge">Inscripcion confirmada</span>
        <h1>¡Listo! Ya estas dentro 🎉</h1>
        <p className="lead" style={{ margin: "12px auto" }}>
          Revisa tu correo: te enviamos el acceso al curso y los siguientes
          pasos. Si no lo ves, revisa la carpeta de spam.
        </p>
        {curso && (
          <a
            className="btn"
            href={`/aula/${curso}`}
            style={{ maxWidth: 300, margin: "20px auto 8px" }}
          >
            Ir al aula ahora
          </a>
        )}
        <a
          href="/"
          style={{ display: "inline-block", marginTop: 8, fontWeight: 600 }}
        >
          Ver mas cursos
        </a>
      </div>
    </main>
  );
}
