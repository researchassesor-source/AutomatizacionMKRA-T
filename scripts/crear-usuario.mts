/**
 * Crea o actualiza una cuenta del panel con una contrasena aleatoria fuerte.
 *
 * La contrasena se genera aqui, se muestra UNA vez y solo se guarda su hash
 * (scrypt con sal). No queda en el repositorio ni en ningun fichero.
 *
 *   npx tsx scripts/crear-usuario.mts "Nombre" correo@dominio DIRECCION
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const [nombre, correo, rol] = process.argv.slice(2);
if (!nombre || !correo || !rol) {
  console.error('Uso: npx tsx scripts/crear-usuario.mts "Nombre" correo@dominio ROL');
  process.exit(1);
}
if (!["ADMIN", "DIRECCION", "MARKETING", "VENTAS", "LECTURA"].includes(rol)) {
  console.error(`Rol no válido: ${rol}`);
  process.exit(1);
}

/** Sin caracteres ambiguos: la I, la l, la O y el 0 se confunden al dictar. */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function generarClave(longitud = 20): string {
  const bytes = randomBytes(longitud * 2);
  let clave = "";
  for (let i = 0; clave.length < longitud; i++) clave += ALFABETO[bytes[i] % ALFABETO.length];
  return clave;
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DBURL });
const clave = generarClave();
const passwordHash = await hashPassword(clave);
const email = correo.trim().toLowerCase();

const existente = await prisma.adminUser.findUnique({ where: { email } });
const usuario = await prisma.adminUser.upsert({
  where: { email },
  create: { name: nombre, email, passwordHash, role: rol as never, isActive: true },
  update: { name: nombre, passwordHash, role: rol as never, isActive: true },
});

await prisma.auditLog.create({
  data: {
    actorEmail: "mantenimiento",
    action: existente ? "USER_UPDATED" : "USER_CREATED",
    entityType: "AdminUser",
    entityId: usuario.id,
    result: "SUCCESS",
    metadata: { role: rol, motivo: "Alta de perfil para el rediseno del panel", passwordRotated: true },
  },
});

console.log(`\n${existente ? "Actualizado" : "Creado"}: ${usuario.name}`);
console.log(`  Correo:     ${usuario.email}`);
console.log(`  Perfil:     ${rol}`);
console.log(`  Contraseña: ${clave}`);
console.log("\nSe muestra una sola vez. En la base solo queda el hash.\n");
await prisma.$disconnect();
