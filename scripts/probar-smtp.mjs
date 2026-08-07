import { createInterface } from "node:readline/promises";
import nodemailer from "nodemailer";

/**
 * Prueba las credenciales SMTP en tu equipo, sin tocar Vercel ni el repositorio.
 *
 * La contraseña se escribe aquí, se usa en memoria y no se guarda en ningún
 * sitio. Sirve para confirmar que funciona antes de gastar un redeploy.
 *
 *   node scripts/probar-smtp.mjs
 */
const HOST = "mail.ra-training.com";
const PORT = 465;

const rl = createInterface({ input: process.stdin, output: process.stdout });

const usuario = (await rl.question(`Usuario SMTP [avillagomez@ra-training.com]: `)).trim() || "avillagomez@ra-training.com";
const clave = (await rl.question("Contraseña (no se guarda): ")).trim();
rl.close();

if (!clave) {
  console.log("\nNo escribiste ninguna contraseña.");
  process.exit(1);
}

console.log(`\nProbando ${usuario} en ${HOST}:${PORT} con TLS…\n`);

const transporter = nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: true,
  auth: { user: usuario, pass: clave },
  connectionTimeout: 15_000,
});

try {
  await transporter.verify();
  console.log("CORRECTO: el servidor acepta estas credenciales.");
  console.log(`\nLongitud de la contraseña: ${clave.length} caracteres.`);
  if (/\s/.test(clave)) console.log("AVISO: contiene espacios. Revisa que no se colaran al copiar.");
  console.log("\nYa puedes ponerla en Vercel como SMTP_PASSWORD y hacer redeploy.");
} catch (error) {
  const code = error?.code ?? "DESCONOCIDO";
  console.log(`FALLO (${code})`);
  if (code === "EAUTH") {
    console.log("\nEl servidor rechaza el usuario o la contraseña.");
    console.log("Cambia la contraseña del buzón en cPanel -> Cuentas de correo -> Administrar.");
    console.log("Usa solo letras y números: algunos símbolos se corrompen al copiar entre sistemas.");
  } else if (code === "ETIMEDOUT" || code === "ECONNECTION") {
    console.log("\nNo se pudo conectar. Puede ser tu red o un cortafuegos bloqueando el puerto 465.");
  } else {
    console.log(`\n${String(error?.message ?? "").slice(0, 200)}`);
  }
  process.exitCode = 1;
}
