import { CRM_PUBLIC_URL, courseCaptureMappings } from "@/data/course-capture-mapping";

export function buildCourseCtaScript() {
  const mappings = Object.fromEntries(
    courseCaptureMappings
      .filter((course) => course.hasOfficialPage && course.hasPrimaryCta)
      .map((course) => [
        new URL(course.officialCourseUrl).pathname,
        `/cursos/${course.crmCourseSlug}`,
      ]),
  );
  const safeMappings = JSON.stringify(mappings).replace(/</g, "\\u003c");
  const fallbackOrigin = JSON.stringify(CRM_PUBLIC_URL);
  return `(() => {
  "use strict";
  const mappings = ${safeMappings};
  const normalizePath = (value) => value.endsWith("/") ? value : value + "/";
  const formPath = mappings[normalizePath(window.location.pathname)];
  if (!formPath) return;
  const scriptOrigin = (() => {
    try { return new URL(document.currentScript && document.currentScript.src || ${fallbackOrigin}).origin; }
    catch { return ${fallbackOrigin}; }
  })();
  const trackingKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  const buildDestination = () => {
    const current = new URL(window.location.href);
    current.hash = "";
    const destination = new URL(formPath, scriptOrigin);
    for (const key of trackingKeys) {
      const value = current.searchParams.get(key);
      if (value) destination.searchParams.set(key, value);
    }
    const explicitSource = current.searchParams.get("source");
    if (explicitSource) destination.searchParams.set("source", explicitSource);
    else if (!current.searchParams.get("utm_source")) destination.searchParams.set("source", "ra-training.com");
    destination.searchParams.set("landing_url", current.toString());
    if (document.referrer) {
      try {
        const referrer = new URL(document.referrer);
        if (referrer.protocol === "http:" || referrer.protocol === "https:") {
          destination.searchParams.set("referrer", referrer.toString());
        }
      } catch {}
    }
    return destination.toString();
  };
  for (const anchor of document.querySelectorAll("a.boton-clase")) {
    anchor.href = buildDestination();
    anchor.dataset.crmCourse = formPath.split("/").pop() || "";
    anchor.addEventListener("click", () => { anchor.href = buildDestination(); });
  }
})();\n`;
}
