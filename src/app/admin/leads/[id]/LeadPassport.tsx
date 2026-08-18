import type { ProgresoPasaporte } from "@/lib/commerce/passport";

/**
 * Progreso del pasaporte de cinco cursos.
 *
 * Habla de pago verificado y de cursos contabilizados, nunca de aprobacion
 * academica: el CRM sabe quien pago, no quien aprobo, y afirmar lo segundo
 * seria inventar una evidencia que no existe.
 */
export function LeadPassport({ progreso }: { progreso: ProgresoPasaporte }) {
  if (progreso.lineas.length === 0) return null;
  return (
    <section className="panel">
      <h2>Progreso de 5 cursos</h2>
      <p>
        <strong>{progreso.contabilizados} de {progreso.meta} cursos con pago verificado</strong>
      </p>
      <ul className="inbox-enrollments">
        {progreso.lineas.map((linea) => (
          <li key={linea.enrollmentId}>
            <span aria-hidden="true">{linea.cuenta ? "✓" : "·"}</span>{" "}
            {linea.courseTitle} <span className="muted">· {linea.etiqueta}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
