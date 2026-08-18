/**
 * Compara las plantillas declaradas en el codigo con las registradas en Meta.
 *
 * Existe porque el CRM no puede saber solo si su catalogo sigue coincidiendo
 * con Meta: Meta es un contrato externo que se edita fuera del repositorio, y
 * cuando deja de coincidir el unico sintoma es un 132000 en el momento del
 * envio, que es el peor momento para enterarse.
 *
 * Solo hace peticiones GET. No envia ningun mensaje, no crea ni edita ninguna
 * plantilla y no imprime el token.
 *
 *   WHATSAPP_ACCESS_TOKEN=... WHATSAPP_WABA_ID=... npx tsx scripts/auditar-plantillas-whatsapp.ts
 */
import { WHATSAPP_TEMPLATES } from "../src/lib/whatsapp/templates";

/** Forma minima de lo que devuelve Graph; solo lo que se compara. */
type ComponenteMeta = { type: string; text?: string; buttons?: Array<{ url?: string }> };
type PlantillaMeta = {
  name: string;
  language: string;
  status: string;
  category?: string;
  parameter_format?: string;
  components?: ComponenteMeta[];
};
type Fila = {
  clave: string;
  plantilla: string;
  semaforo: "GREEN" | "YELLOW" | "RED";
  detalle: string;
  declara: number;
  meta: number | string;
};

const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
const waba = (process.argv[2] ?? process.env.WHATSAPP_WABA_ID ?? "").trim();
const version = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v25.0";

if (!token) {
  console.error("Falta WHATSAPP_ACCESS_TOKEN. En Vercel esta marcada como Sensitive, asi que\n`vercel env pull` la devuelve redactada: hay que tomarla de Meta o del panel de Vercel.");
  process.exit(1);
}
if (!waba) {
  console.error("Falta el identificador de la cuenta de WhatsApp Business (WABA ID).\nNo es el WHATSAPP_PHONE_NUMBER_ID: `message_templates` cuelga de la WABA.\nSe pasa como argumento o en WHATSAPP_WABA_ID.");
  process.exit(1);
}

/** Cuenta los parametros de un componente devuelto por Meta. */
function contarParametros(componente: ComponenteMeta) {
  const texto = componente.text ?? "";
  const posicionales = new Set([...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
  const nombrados = new Set([...texto.matchAll(/\{\{([a-zA-Z_][\w]*)\}\}/g)].map((m) => m[1]));
  return { posicionales: posicionales.size, nombrados: nombrados.size };
}

const remotas = new Map<string, PlantillaMeta>();
let url = `https://graph.facebook.com/${version}/${encodeURIComponent(waba)}/message_templates?limit=100&fields=name,language,status,category,components,parameter_format`;
while (url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? {};
    console.error(`Meta respondio ${res.status}: (#${err.code ?? "?"}) ${err.message ?? "sin detalle"}`);
    process.exit(1);
  }
  for (const t of (json.data ?? []) as PlantillaMeta[]) remotas.set(`${t.name}::${t.language}`, t);
  url = json.paging?.next ?? null;
}

const filas: Fila[] = [];
for (const [clave, spec] of Object.entries(WHATSAPP_TEMPLATES)) {
  const remota = remotas.get(`${spec.name}::${spec.language}`);
  const otroIdioma = [...remotas.values()].filter((t) => t.name === spec.name).map((t) => t.language);

  if (!remota) {
    filas.push({
      clave, plantilla: spec.name, semaforo: "RED",
      detalle: otroIdioma.length ? `existe en Meta pero en ${otroIdioma.join(", ")}, no en "${spec.language}"` : "no existe en Meta",
      declara: spec.bodyVars.length, meta: "-",
    });
    continue;
  }

  const body = (remota.components ?? []).find((c: ComponenteMeta) => c.type === "BODY");
  const header = (remota.components ?? []).find((c: ComponenteMeta) => c.type === "HEADER");
  const botones = (remota.components ?? []).find((c: ComponenteMeta) => c.type === "BUTTONS");
  const cuerpo = body ? contarParametros(body) : { posicionales: 0, nombrados: 0 };
  const headerVars = header ? contarParametros(header) : { posicionales: 0, nombrados: 0 };
  const botonVars = (botones?.buttons ?? []).filter((b: { url?: string }) => typeof b.url === "string" && b.url.includes("{{")).length;
  const codigoUsaBoton = spec.urlVar ? 1 : 0;

  const problemas = [];
  if (remota.status !== "APPROVED") problemas.push(`estado ${remota.status}`);
  if (cuerpo.posicionales !== spec.bodyVars.length) problemas.push(`BODY: Meta ${cuerpo.posicionales} vs codigo ${spec.bodyVars.length}`);
  if (cuerpo.nombrados > 0) problemas.push(`BODY usa parametros con nombre (${cuerpo.nombrados}); el CRM envia posicionales`);
  if (remota.parameter_format && remota.parameter_format !== "POSITIONAL") problemas.push(`parameter_format=${remota.parameter_format}`);
  if (headerVars.posicionales + headerVars.nombrados > 0) problemas.push(`HEADER espera ${headerVars.posicionales + headerVars.nombrados} variable(s); el CRM no envia HEADER`);
  if (botonVars !== codigoUsaBoton) problemas.push(`BUTTON: Meta ${botonVars} vs codigo ${codigoUsaBoton}`);

  filas.push({
    clave, plantilla: spec.name,
    semaforo: problemas.length === 0 ? "GREEN" : remota.status !== "APPROVED" && problemas.length === 1 ? "YELLOW" : "RED",
    detalle: problemas.join(" · ") || "coincide",
    declara: spec.bodyVars.length, meta: cuerpo.posicionales,
  });
}

console.table(filas);
const cuenta = (s: Fila["semaforo"]) => filas.filter((f) => f.semaforo === s).length;
console.log(`\nGREEN ${cuenta("GREEN")} · YELLOW ${cuenta("YELLOW")} · RED ${cuenta("RED")} · total ${filas.length}`);
console.log("Solo se hicieron peticiones GET. No se envio ningun mensaje.");
