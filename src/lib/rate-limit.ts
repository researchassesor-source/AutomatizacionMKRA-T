import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();

function localRateLimit(key: string, options: { limit: number; windowMs: number }, now = Date.now()) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0, distributed: false };
  }
  current.count += 1;
  if (buckets.size > 5000) for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  return { allowed: current.count <= options.limit, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)), distributed: false };
}

export async function checkRateLimit(key: string, options: { limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number; distributed: boolean }> {
  const useDatabase = process.env.RATE_LIMIT_MODE === "database" || process.env.VERCEL === "1";
  if (!useDatabase) return localRateLimit(key, options);
  const now = new Date();
  const resetAt = new Date(now.getTime() + options.windowMs);
  const hashedKey = createHash("sha256").update(key).digest("hex");
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "rate_limit_buckets" ("key", "count", "resetAt", "updatedAt")
      VALUES (${hashedKey}, 1, ${resetAt}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
        "resetAt" = CASE WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN ${resetAt} ELSE "rate_limit_buckets"."resetAt" END,
        "updatedAt" = ${now}
      RETURNING "count", "resetAt"
    `;
    const bucket = rows[0];
    if (!bucket) throw new Error("RATE_LIMIT_BUCKET_MISSING");
    return { allowed: bucket.count <= options.limit, retryAfterSeconds: bucket.count <= options.limit ? 0 : Math.max(1, Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000)), distributed: true };
  } catch {
    console.error("[rate-limit] No se pudo usar el límite distribuido; se aplicó el límite local de respaldo.");
    return localRateLimit(hashedKey, options, now.getTime());
  }
}

export function requestKey(request: Request, prefix: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${prefix}:${forwarded || request.headers.get("x-real-ip") || "local"}`;
}
