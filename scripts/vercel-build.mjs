import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const PREVIEW_FLAG = "PREVIEW_DATABASE_MIGRATIONS_ENABLED";
const POOLED_URL = "POSTGRES_PRISMA_URL";
const DIRECT_URL = "POSTGRES_URL_NON_POOLING";
const PREPARE_SCRIPT = fileURLToPath(new URL("./prepare-preview-migrations.mjs", import.meta.url));
const VERIFY_SCRIPT = fileURLToPath(new URL("./verify-database-schema.mjs", import.meta.url));
const require = createRequire(import.meta.url);
const PRISMA_CLI = require.resolve("prisma/build/index.js");
const NEXT_CLI = require.resolve("next/dist/bin/next");

function sanitized(text, env) {
  let output = String(text ?? "");
  output = output.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[DATABASE_URL_REDACTED]");
  for (const [name, value] of Object.entries(env)) {
    if (!value || !/(PASSWORD|SECRET|TOKEN|DATABASE_URL|POSTGRES.*URL|AUTHORIZATION|COOKIE)/i.test(name)) continue;
    output = output.split(value).join(`[${name}_REDACTED]`);
  }
  return output;
}

function defaultRunner(command, args, { env, cwd }) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function requireConnection(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Falta la variable ${name}.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`La variable ${name} no contiene una URL válida.`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(`La variable ${name} debe usar PostgreSQL.`);
  }
  return parsed;
}

function createCommandRunner({ env, cwd, runner, logger }) {
  return (label, command, args) => {
    logger.info(`[vercel-build] ${label}`);
    const result = runner(command, args, { env, cwd });
    const stdout = sanitized(result?.stdout, env);
    const stderr = sanitized(result?.stderr, env);
    if (stdout) logger.info(stdout.trimEnd());
    if (stderr) logger.error(stderr.trimEnd());
    if (result?.error) throw new Error(`${label} falló: ${sanitized(result.error.message, env)}`);
    if (result?.status !== 0) throw new Error(`${label} falló con código ${result?.status ?? "desconocido"}.`);
  };
}

export function runVercelBuild({
  env = process.env,
  cwd = process.cwd(),
  runner = defaultRunner,
  logger = console,
} = {}) {
  const configuredEnvironment = env.VERCEL_ENV?.trim();
  const environment = configuredEnvironment || "development";
  const run = createCommandRunner({ env, cwd, runner, logger });
  const prisma = (label, args) => run(label, process.execPath, [PRISMA_CLI, ...args]);
  const nextBuild = () => run("Compilando Next.js", process.execPath, [NEXT_CLI, "build"]);

  logger.info(`[vercel-build] Entorno detectado: ${environment}.`);

  if (!['preview', 'production', 'development'].includes(environment)) {
    throw new Error(`VERCEL_ENV tiene un valor no admitido: ${environment}.`);
  }

  if (environment === "preview") {
    if (env[PREVIEW_FLAG]?.trim().toLowerCase() !== "true") {
      throw new Error(`Preview bloqueado: habilita ${PREVIEW_FLAG}=true únicamente en Preview.`);
    }
    if (env.VERCEL_TARGET_ENV && env.VERCEL_TARGET_ENV !== "preview") {
      throw new Error("Preview bloqueado: VERCEL_TARGET_ENV no identifica un entorno Preview.");
    }
    requireConnection(env, POOLED_URL);
    const direct = requireConnection(env, DIRECT_URL);
    if (env.VERCEL === "1" && /(?:^|-)pooler(?:\.|$)/i.test(direct.hostname)) {
      throw new Error(`Preview bloqueado: ${DIRECT_URL} parece ser una conexión pooled.`);
    }

    prisma("Validando el esquema Prisma", ["validate"]);
    run("Preparando el historial de migraciones del Preview", process.execPath, [PREPARE_SCRIPT]);
    prisma("Aplicando migraciones del Preview aislado", ["migrate", "deploy"]);
    prisma("Comprobando el estado de migraciones", ["migrate", "status"]);
    prisma("Generando Prisma Client", ["generate"]);
    run("Verificando estructuras críticas", process.execPath, [VERIFY_SCRIPT]);
    nextBuild();
    logger.info("[vercel-build] Preview validado y compilado sin seeds.");
    return;
  }

  if (environment === "production") {
    logger.info("[vercel-build] Las migraciones automáticas están desactivadas en Producción.");
    prisma("Validando el esquema Prisma", ["validate"]);
    prisma("Generando Prisma Client", ["generate"]);
    nextBuild();
    return;
  }

  logger.info("[vercel-build] Desarrollo local: las migraciones automáticas están desactivadas.");
  prisma("Generando Prisma Client", ["generate"]);
  nextBuild();
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  try {
    runVercelBuild();
  } catch (error) {
    console.error(`[vercel-build] ${sanitized(error instanceof Error ? error.message : error, process.env)}`);
    process.exitCode = 1;
  }
}
