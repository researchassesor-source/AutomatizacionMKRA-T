import type { Metadata } from "next";
import { verifyFolio } from "@/lib/certificates";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ folio: string }>;
}): Promise<Metadata> {
  const { folio } = await params;
  return { title: `Verificar ${folio} · RA-Training` };
}

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function VerificarPage({
  params,
}: {
  params: Promise<{ folio: string }>;
}) {
  const { folio } = await params;
  const cert = await verifyFolio(folio);

  return (
    <main className="verify-box">
      <div className="verify-card">
        {cert ? (
          <>
            <div className="verify-valid">✅</div>
            <h1 style={{ margin: "6px 0" }}>Certificado valido</h1>
            <p className="muted">Folio {cert.folio}</p>
            <div className="cert-meta" style={{ textAlign: "left", marginTop: 24 }}>
              <div>
                Titular
                <strong>{cert.holderName}</strong>
              </div>
            </div>
            <div className="cert-meta" style={{ textAlign: "left", marginTop: 12 }}>
              <div>
                Curso
                <strong>{cert.courseTitle}</strong>
              </div>
            </div>
            <div className="cert-meta" style={{ marginTop: 12 }}>
              <div>
                Emitido
                <strong>{fmtDate(cert.issuedAt)}</strong>
              </div>
              <div style={{ textAlign: "right" }}>
                Tipo
                <strong>{cert.official ? "Oficial" : "Constancia"}</strong>
              </div>
            </div>
            <p style={{ marginTop: 24 }}>
              <a className="btn-sm" href={`/certificado/${cert.folio}`}>
                Ver certificado
              </a>
            </p>
          </>
        ) : (
          <>
            <div className="verify-valid">❌</div>
            <h1 style={{ margin: "6px 0" }}>Certificado no encontrado</h1>
            <p className="muted">
              El folio <strong>{folio}</strong> no corresponde a ningun
              certificado valido emitido por RA-Training.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
