import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Callback requerido por el portal. El CRM no solicita ni implementa Ads. */
export async function GET() {
  const base = process.env.APP_URL?.trim() || "https://automatizacion-mkra-t2.vercel.app";
  return NextResponse.redirect(new URL("/admin/redes?tiktokBusiness=advertiser_no_implementado", base));
}
