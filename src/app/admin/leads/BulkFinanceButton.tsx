"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Curso = { id: string; title: string };
type PreviewItem = { enrollmentId: string; leadName: string; status: string; motivo?: string };
type Preview = {
  courseId: string;
  courseTitle: string;
  total: number;
  porEnviar: number;
  yaVinculados: number;
  cancelados: number;
  requierenConfiguracion: number;
  items: PreviewItem[];
};

/**
 * "Enviar curso a Finance" (sección T del release de estabilización).
 *
 * Vista previa con conteos ANTES de tocar nada, una sola confirmación
 * global, y el envío ocurre entero en el servidor (una llamada, no un
 * bucle de fetch por inscripción desde el navegador).
 */
export function BulkFinanceButton({ courses }: { courses: Curso[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ enviados: number; fallidos: number; fallaGlobal: string | null } | null>(null);

  function abrir() {
    setAbierto(true);
    setCourseId("");
    setPreview(null);
    setResultado(null);
    setError(null);
  }

  function cerrar() {
    setAbierto(false);
  }

  async function cargarVistaPrevia(idCurso: string) {
    setCourseId(idCurso);
    setPreview(null);
    setResultado(null);
    setError(null);
    if (!idCurso) return;
    setCargando(true);
    const response = await fetch("/api/admin/commerce/finance-bulk/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: idCurso }),
    }).catch(() => null);
    setCargando(false);
    if (!response || !response.ok) {
      const detalle = await response?.json().catch(() => ({}));
      setError(detalle?.error ?? "No se pudo preparar la vista previa.");
      return;
    }
    setPreview(await response.json());
  }

  async function confirmarEnvio() {
    if (!preview) return;
    setEnviando(true);
    setError(null);
    const response = await fetch("/api/admin/commerce/finance-bulk/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: preview.courseId, confirm: "SEND_COURSE_TO_FINANCE" }),
    }).catch(() => null);
    setEnviando(false);
    if (!response || !response.ok) {
      const detalle = await response?.json().catch(() => ({}));
      setError(detalle?.error ?? "No se pudo completar el envío.");
      return;
    }
    const body = await response.json();
    setResultado({ enviados: body.enviados, fallidos: body.fallidos, fallaGlobal: body.fallaGlobal });
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn-sm ghost" onClick={abrir}>Enviar curso a Finance</button>
      {abierto ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="finance-bulk-titulo">
            <h2 id="finance-bulk-titulo">Enviar curso a Finance</h2>

            {!resultado ? (
              <>
                <label className="field">
                  <span>Curso</span>
                  <select value={courseId} onChange={(event) => cargarVistaPrevia(event.target.value)} disabled={cargando || enviando}>
                    <option value="">Selecciona un curso…</option>
                    {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                  </select>
                </label>

                {cargando ? <p className="muted">Preparando vista previa…</p> : null}
                {error ? <p className="feedback-error">{error}</p> : null}

                {preview ? (
                  <div className="finance-bulk-preview">
                    <p className="sync-resumen">
                      <strong>{preview.porEnviar}</strong> por enviar · <strong>{preview.yaVinculados}</strong> ya vinculados ·{" "}
                      <strong>{preview.cancelados}</strong> cancelados · <strong>{preview.requierenConfiguracion}</strong> requieren configuración
                    </p>
                    {preview.requierenConfiguracion > 0 ? (
                      <p className="muted">Configura la modalidad y las fechas del curso para incluir a quienes faltan.</p>
                    ) : null}
                    {preview.porEnviar === 0 ? <p className="muted">No hay nada pendiente de enviar para este curso.</p> : null}
                  </div>
                ) : null}

                <div className="dialog-actions">
                  <button type="button" className="btn-sm ghost" onClick={cerrar} disabled={enviando}>Cancelar</button>
                  {preview && preview.porEnviar > 0 ? (
                    <button type="button" className="btn-sm" onClick={confirmarEnvio} disabled={enviando}>
                      {enviando ? "Enviando…" : `Enviar ${preview.porEnviar} a Finance`}
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <p className={resultado.fallaGlobal ? "feedback-error" : "form-success"}>
                  {resultado.enviados} enviado{resultado.enviados === 1 ? "" : "s"}
                  {resultado.fallidos > 0 ? `, ${resultado.fallidos} fallido${resultado.fallidos === 1 ? "" : "s"}` : ""}.
                </p>
                {resultado.fallaGlobal ? (
                  <p className="muted">Finance no respondió a mitad del envío; lo que faltó puede reintentarse más tarde.</p>
                ) : null}
                <div className="dialog-actions">
                  <button type="button" className="btn-sm" onClick={cerrar}>Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
