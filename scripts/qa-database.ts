import { PrismaClient } from "@prisma/client";

const action = process.argv[2];
const databaseName = process.argv[3];
const sourceUrl = process.env.POSTGRES_PRISMA_URL;

if (!sourceUrl) throw new Error("Falta la conexión local de PostgreSQL.");
const parsedUrl = new URL(sourceUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("Esta utilidad solo puede operar contra PostgreSQL local.");
}
if (!/^mkra_codex_qa_[a-z0-9_]+$/.test(databaseName ?? "")) {
  throw new Error("El nombre de la base temporal no cumple el prefijo seguro.");
}
if (decodeURIComponent(parsedUrl.pathname.slice(1)) === databaseName) {
  throw new Error("La conexión administrativa no puede apuntar a la base temporal.");
}
if (!['create', 'drop'].includes(action ?? '')) throw new Error("Acción no válida.");

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS "exists"
  `;
  const exists = existing[0]?.exists === true;

  if (action === "create") {
    if (!exists) await prisma.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    console.log(exists ? "Base temporal ya disponible." : "Base temporal creada.");
    return;
  }

  if (exists) {
    await prisma.$queryRaw`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${databaseName} AND pid <> pg_backend_pid()
    `;
    await prisma.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
  }
  console.log(exists ? "Base temporal eliminada." : "La base temporal ya estaba ausente.");
}

main().finally(() => prisma.$disconnect());
