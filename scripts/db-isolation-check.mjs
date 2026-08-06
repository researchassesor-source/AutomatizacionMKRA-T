import { createHash } from "node:crypto";

/**
 * Comprueba si dos conexiones PostgreSQL apuntan a bases distintas.
 * SOLO LECTURA: no conecta a ninguna base, solo compara las cadenas.
 *
 * Nunca imprime usuario, contraseña, query string ni la URL completa: solo una
 * huella redactada y el veredicto.
 *
 * Uso (sin dejar las URLs en el historial del shell):
 *
 *   PREVIEW_DB_URL=... PRODUCTION_DB_URL=... node scripts/db-isolation-check.mjs
 *
 * Para obtener los valores sin exponerlos en pantalla:
 *   vercel env pull .env.preview    --environment=preview
 *   vercel env pull .env.production --environment=production
 * y luego borrar ambos archivos. Están cubiertos por .gitignore (.env*).
 */
function maskHost(host) {
  if (!host) return "(sin host)";
  const parts = host.split(".");
  const first = parts[0] ?? "";
  const head = first.slice(0, 3);
  const tail = parts.length > 1 ? `.${parts.slice(-2).join(".")}` : "";
  return `${head}${"*".repeat(Math.max(3, first.length - 3))}${tail}`;
}

function maskDatabase(pathname) {
  const name = (pathname ?? "").replace(/^\//, "");
  if (!name) return "(sin base)";
  if (name.length <= 2) return "*".repeat(name.length);
  return `${name.slice(0, 2)}${"*".repeat(Math.max(3, name.length - 2))}`;
}

function fingerprint(rawUrl, label) {
  if (!rawUrl?.trim()) return { label, present: false };
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { label, present: true, invalid: true };
  }
  // La identidad de la base es host + puerto + nombre. El usuario, la
  // contraseña y los parámetros de pooling no cuentan para la comparación.
  const identity = `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}${parsed.pathname.toLowerCase()}`;
  return {
    label,
    present: true,
    invalid: false,
    host: maskHost(parsed.hostname),
    port: parsed.port || "5432",
    database: maskDatabase(parsed.pathname),
    identity,
    urlHash: createHash("sha256").update(rawUrl.trim()).digest("hex").slice(0, 12),
    identityHash: createHash("sha256").update(identity).digest("hex").slice(0, 12),
  };
}

function print(entry) {
  if (!entry.present) return console.log(`${entry.label.padEnd(12)} no definida`);
  if (entry.invalid) return console.log(`${entry.label.padEnd(12)} valor presente pero no es una URL válida`);
  console.log(`${entry.label.padEnd(12)} host=${entry.host} puerto=${entry.port} base=${entry.database}`);
  console.log(`${"".padEnd(12)} sha256(url)=${entry.urlHash}… sha256(identidad)=${entry.identityHash}…`);
}

const entries = [
  fingerprint(process.env.PREVIEW_DB_URL, "Preview"),
  fingerprint(process.env.PRODUCTION_DB_URL, "Producción"),
];

console.log("Comprobación de aislamiento de bases · solo lectura, sin conexión\n");
for (const entry of entries) print(entry);

const [preview, production] = entries;
console.log("");
if (!preview.present || !production.present) {
  console.log("VEREDICTO: INDETERMINADO. Faltan PREVIEW_DB_URL o PRODUCTION_DB_URL.");
  console.log("Mientras no se confirme el aislamiento, PREVIEW_DATABASE_MIGRATIONS_ENABLED debe permanecer desactivada.");
  process.exitCode = 2;
} else if (preview.invalid || production.invalid) {
  console.log("VEREDICTO: INDETERMINADO. Alguna URL no es válida.");
  process.exitCode = 2;
} else if (preview.identity === production.identity) {
  console.log("VEREDICTO: IGUALES. Preview y Producción apuntan a la MISMA base.");
  console.log("PREVIEW_DATABASE_MIGRATIONS_ENABLED debe permanecer en false.");
  console.log("Ningún Preview puede ejecutar migraciones: escribiría sobre datos reales.");
  process.exitCode = 1;
} else {
  console.log("VEREDICTO: DIFERENTES. Preview y Producción están aisladas.");
  console.log("Preview puede ejecutar migraciones con PREVIEW_DATABASE_MIGRATIONS_ENABLED=true, solo en Preview.");
}
