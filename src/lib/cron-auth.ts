export function checkCronAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const supplied = request.headers.get("authorization");
  if (!supplied || supplied.length !== `Bearer ${secret}`.length) return false;
  let mismatch = 0;
  const expected = `Bearer ${secret}`;
  for (let index = 0; index < expected.length; index++) {
    mismatch |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}
