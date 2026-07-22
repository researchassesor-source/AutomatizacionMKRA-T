import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// El buscador de verificacion tambien vive en ra-training-finance.
export default function VerificarIndex() {
  const base = (process.env.FINANCE_APP_URL ?? "").replace(/\/$/, "");

  if (!base) {
    return (
      <main className="verify-box">
        <div className="verify-card">
          <h1 style={{ marginTop: 0 }}>Verificar un certificado</h1>
          <p className="muted">
            La verificacion se realiza en el sistema de RA-Training. Configura{" "}
            <code>FINANCE_APP_URL</code> para habilitar el enlace.
          </p>
        </div>
      </main>
    );
  }

  redirect(`${base}/verificar`);
}
