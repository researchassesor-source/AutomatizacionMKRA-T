import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AdminSession } from "@/lib/auth/session";

const BLOCKED_KEYS = /password|hash|token|secret|credential|authorization|cookie/i;

function sanitizeValue(value: unknown, depth: number): Prisma.InputJsonValue | undefined {
  if (depth > 5 || value === undefined) return undefined;
  if (value === null) return undefined;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item): item is Prisma.InputJsonValue => item !== undefined);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !BLOCKED_KEYS.test(key))
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
        .filter((entry): entry is [string, Prisma.InputJsonValue] => entry[1] !== undefined),
    );
  }
  return String(value).slice(0, 500);
}

export function sanitizeAuditMetadata(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  return value ? sanitizeValue(value, 0) : undefined;
}

export async function writeAudit(input: {
  session?: AdminSession | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  result?: "SUCCESS" | "FAILURE";
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.session?.userId ?? null,
        actorEmail: input.session?.email ?? input.actorEmail ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        result: input.result ?? "SUCCESS",
        metadata: sanitizeAuditMetadata(input.metadata),
      },
    });
  } catch {
    console.error("[audit] No se pudo registrar el evento.");
  }
}
