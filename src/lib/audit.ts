import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AdminSession } from "@/lib/auth/session";

const BLOCKED_KEYS = /password|hash|token|secret|credential|authorization|cookie/i;

function safeMetadata(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !BLOCKED_KEYS.test(key))
      .map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 500) : item]),
  ) as Prisma.InputJsonValue;
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
        metadata: safeMetadata(input.metadata),
      },
    });
  } catch {
    console.error("[audit] No se pudo registrar el evento.");
  }
}
