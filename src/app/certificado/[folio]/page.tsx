import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { verifyFolio } from "@/lib/certificates";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ folio: string }>;
}): Promise<Metadata> {
  const { folio } = await params;
  return { title: `Certificado ${folio} · RA-Training` };
}

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function CertificadoPage({
  params,
}: {
  params: Promise<{ folio: string }>;
}) {
  const { folio } = await params;
  const cert = await verifyFolio(folio);
  if (!cert) notFound();

  const appUrl = process.env.APP_URL ?? "https://ra-training.com";

  return (
    <main className="cert-page">
      <div className="certificate">
        <div className="cert-brand">RA-Training</div>
        <div className="cert-kicker">
          {cert.official
            ? "Certifica que"
            : "Otorga la presente constancia de finalizacion a"}
        </div>
        <div className="cert-name">{cert.holderName}</div>
        <div className="cert-kicker">por completar satisfactoriamente el curso</div>
        <div className="cert-course">{cert.courseTitle}</div>

        {cert.official && (
          <div className="cert-official">Aval oficial · Ministerio de Trabajo</div>
        )}

        <div className="cert-meta">
          <div>
            Fecha de emision
            <strong>{fmtDate(cert.issuedAt)}</strong>
          </div>
          <div style={{ textAlign: "right" }}>
            Folio de verificacion
            <strong>{cert.folio}</strong>
          </div>
        </div>
      </div>

      <div className="cert-actions">
        <PrintButton />
        <p className="muted" style={{ marginTop: 12 }}>
          Verifica la autenticidad en{" "}
          <a href={`/verificar/${cert.folio}`}>
            {appUrl.replace(/^https?:\/\//, "")}/verificar/{cert.folio}
          </a>
        </p>
      </div>
    </main>
  );
}
