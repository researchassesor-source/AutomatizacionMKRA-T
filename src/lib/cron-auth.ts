// Autorizacion para los endpoints de cron.
// Vercel Cron envia la cabecera "Authorization: Bearer <CRON_SECRET>" cuando
// la variable CRON_SECRET esta definida. Si no hay secret, se permite (dev).
export function checkCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
