import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { readJsonBody } from "@/lib/http";
import { leadActivitySchema } from "@/lib/lead-validation";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { isAllowedPublicLeadOrigin, publicLeadCorsHeaders } from "@/lib/public-origin";

export const dynamic = "force-dynamic";

function headers(request: Request, requestId: string) {
  const result = publicLeadCorsHeaders(request.headers.get("origin"), request.url);
  result.set("X-Request-Id", requestId);
  return result;
}

export async function OPTIONS(request: Request) {
  const requestId = crypto.randomUUID();
  if (!isAllowedPublicLeadOrigin(request.headers.get("origin"), request.url)) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers: headers(request, requestId) });
  }
  return new Response(null, { status: 204, headers: headers(request, requestId) });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  if (!isAllowedPublicLeadOrigin(request.headers.get("origin"), request.url)) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers: headers(request, requestId) });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Contenido no válido." }, { status: 415, headers: headers(request, requestId) });
  }
  const limit = await checkRateLimit(requestKey(request, "lead-activity"), {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) return new Response(null, { status: 204, headers: headers(request, requestId) });

  const parsed = leadActivitySchema.safeParse(await readJsonBody(request, 8_192).catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos no válidos." }, { status: 422, headers: headers(request, requestId) });
  }
  const course = await prisma.course.findFirst({
    where: {
      slug: parsed.data.courseSlug,
      isPublished: true,
      acceptsRegistrations: true,
    },
    select: { id: true, slug: true },
  });
  if (!course) return new Response(null, { status: 204, headers: headers(request, requestId) });

  await writeAudit({
    actorEmail: "public-form",
    action: parsed.data.eventType,
    entityType: "Course",
    entityId: course.id,
    metadata: {
      requestId,
      activityKey: parsed.data.activityKey,
      courseSlug: course.slug,
      source: parsed.data.source ?? parsed.data.utmSource ?? "landing",
      campaign: parsed.data.utmCampaign,
      content: parsed.data.utmContent,
      term: parsed.data.utmTerm,
      fbclid: parsed.data.fbclid,
      gclid: parsed.data.gclid,
      ttclid: parsed.data.ttclid,
      landingUrl: parsed.data.landingUrl,
      referrer: parsed.data.referrer,
    },
  });
  return new Response(null, { status: 204, headers: headers(request, requestId) });
}
