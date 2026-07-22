import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// La verificacion de certificados vive en ra-training-finance (fuente de
// verdad). MKRA-T solo redirige alli.
export default async function VerificarRedirect({
  params,
}: {
  params: Promise<{ folio: string }>;
}) {
  const { folio } = await params;
  const base = (process.env.FINANCE_APP_URL ?? "").replace(/\/$/, "");

  if (!base) {
    return (
      <main className="verify-box">
        <div className="verify-card">
          <h1 style={{ marginTop: 0 }}>Verificacion no disponible</h1>
          <p className="muted">
            Configura <code>FINANCE_APP_URL</code> para enlazar con el sistema de
            verificacion de RA-Training.
          </p>
        </div>
      </main>
    );
  }

  redirect(`${base}/verificar/${encodeURIComponent(folio)}`);
}
