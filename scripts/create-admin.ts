import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();
const args = Object.fromEntries(
  process.argv.slice(2).map((part) => {
    const [key, ...value] = part.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);

async function main() {
  const email = String(args.email ?? "").trim().toLowerCase();
  const name = String(args.name ?? "Administrador local").trim();
  const password = process.env.CRM_ADMIN_PASSWORD ?? "";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Indica --email=correo-valido");
  if (!password) throw new Error("Define CRM_ADMIN_PASSWORD solo durante la ejecución del comando.");
  const passwordHash = await hashPassword(password);
  await prisma.adminUser.upsert({
    where: { email },
    update: { name, passwordHash, role: "ADMIN", isActive: true },
    create: { email, name, passwordHash, role: "ADMIN", isActive: true },
  });
  console.log(`Administrador local preparado: ${email}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo crear el administrador.");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
