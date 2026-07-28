import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifySessionToken } from "./session";
import { resolveActiveAdminSession } from "./active-session";

export async function currentAdminSession() {
  const store = await cookies();
  const session = await verifySessionToken(store.get(ADMIN_COOKIE)?.value);
  const activeSession = await resolveActiveAdminSession(session);
  if (!activeSession) redirect("/admin/login");
  return activeSession;
}
