import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { ejecutarTick } from "@/lib/cron-tick";

export const dynamic = "force-dynamic";
// La firma de QStash se calcula sobre el cuerpo crudo, y eso exige node:crypto.
export const runtime = "nodejs";
// Los dos subsistemas comparten una sola invocacion, asi que necesita mas
// margen que cualquiera de ellos por separado.
export const maxDuration = 60;

/**
 * Reloj maestro del CRM.
 *
 * Un unico despertar que ejecuta publicaciones sociales y comunicaciones
 * automaticas en el mismo proceso. Existe para que baste UN schedule externo:
 * con dos endpoints y un disparo por minuto se superaba el limite diario del
 * plan contratado, y de todos modos que el servidor se llame a si mismo por
 * HTTP solo añade latencia y un punto de fallo.
 *
 * Los endpoints `/api/social/publish` y `/api/nurture/dispatch` se conservan:
 * sirven para diagnosticar cada subsistema por separado y para que el reloj
 * anterior siga funcionando mientras dure la migracion.
 *
 * POST es lo que usa QStash. GET queda para poder comprobarlo a mano con el
 * mismo `CRON_SECRET`.
 */
async function ejecutar(request: Request, rawBody?: string) {
  if (!checkCronAuth(request, rawBody)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  const resultado = await ejecutarTick();
  // 200 aunque un subsistema falle: el reloj respondio y el detalle va en el
  // cuerpo. Un 500 haria que QStash reintentara el tick entero, incluida la
  // parte que si funciono.
  return NextResponse.json(resultado);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  return ejecutar(request, rawBody);
}

export async function GET(request: Request) {
  return ejecutar(request);
}
