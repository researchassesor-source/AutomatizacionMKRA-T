import { buildCourseCtaScript } from "@/lib/course-cta-script";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildCourseCtaScript(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
