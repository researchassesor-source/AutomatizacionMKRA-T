export default function GraciasPage() {
  return (
    <main className="container">
      <div className="center-narrow">
        <span className="badge">Inscripcion confirmada</span>
        <h1>¡Listo! Ya estas dentro 🎉</h1>
        <p className="lead" style={{ margin: "12px auto" }}>
          Revisa tu correo: te enviamos el acceso al curso y los siguientes
          pasos. Si no lo ves, revisa la carpeta de spam.
        </p>
        <a className="btn" href="/" style={{ maxWidth: 260, margin: "20px auto" }}>
          Ver mas cursos
        </a>
      </div>
    </main>
  );
}
