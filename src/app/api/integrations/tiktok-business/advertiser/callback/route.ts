export const dynamic = "force-dynamic";

/** Callback requerido por el portal. El CRM no solicita ni implementa Ads. */
export async function GET() {
  return Response.json({
    ok: true,
    status: "ready",
    message: "Callback de anunciante disponible; Ads no está implementado actualmente.",
  });
}
