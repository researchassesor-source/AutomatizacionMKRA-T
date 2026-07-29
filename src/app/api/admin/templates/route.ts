import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { TEMPLATE_VARIABLES } from "@/lib/nurture/engine";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().trim().max(200).optional().or(z.literal("")),
  body: z.string().trim().min(2).max(10000),
  category: z.string().trim().max(80).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
}).superRefine((data, context) => {
  if (data.channel === "EMAIL" && !data.subject) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["subject"], message: "El asunto es obligatorio para correo." });
  }
  if (data.channel === "WHATSAPP" && data.subject) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["subject"], message: "WhatsApp no utiliza asunto." });
  }
  for (const match of `${data.subject ?? ""} ${data.body}`.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!TEMPLATE_VARIABLES.includes(match[1] as (typeof TEMPLATE_VARIABLES)[number])) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Variable no permitida: {{${match[1]}}}` });
    }
  }
});

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Plantilla no válida." }, { status: 422 });
  const template = await prisma.messageTemplate.create({
    data: {
      ...parsed.data,
      subject: parsed.data.subject || null,
      category: parsed.data.category || null,
      availableVariables: [...TEMPLATE_VARIABLES],
    },
  });
  await writeAudit({ session: auth.session, action: "TEMPLATE_CREATED", entityType: "MessageTemplate", entityId: template.id });
  return NextResponse.json({ ok: true, template }, { status: 201 });
}
