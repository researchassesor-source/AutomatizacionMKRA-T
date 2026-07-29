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
            La verificación se realiza en R.A. Training Finance y no está disponible temporalmente desde este entorno.
          </p>
        </div>
      </main>
    );
  }

  redirect(`${base}/verificar`);
}
