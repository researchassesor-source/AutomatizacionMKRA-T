import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  applyMessageProviderEvent: vi.fn(),
  handleInboundSupportReply: vi.fn(),
  guardarMensajeEntrante: vi.fn(async () => ({ estado: "guardado", inboundId: "in-1", leadId: null, handoffAbierto: true })),
}));

vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/nurture/provider-events", () => ({
  applyMessageProviderEvent: mocks.applyMessageProviderEvent,
}));
vi.mock("@/lib/whatsapp/config", () => ({
  resolveWhatsAppConfig: () => ({ appSecret: "webhook-secret-de-prueba" }),
}));
vi.mock("@/lib/whatsapp/inbound-reply", () => ({
  handleInboundSupportReply: mocks.handleInboundSupportReply,
}));
// La persistencia tiene su propia bateria; aqui solo importa que el webhook la
// invoque por cada entrante y que un fallo suyo no tumbe el lote.
vi.mock("@/lib/whatsapp/inbound-store", () => ({
  guardarMensajeEntrante: mocks.guardarMensajeEntrante,
}));

import { POST } from "./route";

const WEBHOOK_SECRET = "webhook-secret-de-prueba";

function signedRequest(payload: unknown) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("hex");
  return new Request("https://crm.example/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${signature}` },
    body,
  });
}

describe("POST webhook WhatsApp", () => {
  beforeEach(() => {
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.applyMessageProviderEvent.mockResolvedValue({ found: true, duplicate: false, changed: true });
    mocks.handleInboundSupportReply.mockResolvedValue({ status: "sent" });
  });

  it("mantiene sent/delivered/read y procesa la respuesta inbound en el mismo lote", async () => {
    const response = await POST(signedRequest({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { display_phone_number: "+593 99 111 2222" },
            statuses: [
              { id: "wamid.ONE", status: "sent", timestamp: "1786000000" },
              { id: "wamid.TWO", status: "delivered", timestamp: "1786000001" },
              { id: "wamid.THREE", status: "read", timestamp: "1786000002" },
            ],
            messages: [{
              id: "wamid.IN",
              from: "593991234567",
              type: "text",
              text: { body: "contenido que no debe persistirse" },
            }],
          },
        }],
      }],
    }));

    expect(response.status).toBe(200);
    expect(mocks.applyMessageProviderEvent).toHaveBeenCalledTimes(3);
    expect(mocks.applyMessageProviderEvent.mock.calls.map(([event]) => event.state))
      .toEqual(["SENT", "DELIVERED", "READ"]);
    // El aviso ahora lleva ademas contenido, momento y contexto: se comprueba
    // lo que identifica al mensaje sin fijar el resto del contrato aqui.
    expect(mocks.handleInboundSupportReply).toHaveBeenCalledWith(expect.objectContaining({
      providerMessageId: "wamid.IN",
      type: "text",
      sender: "593991234567",
      businessPhone: "+593 99 111 2222",
    }));
    // Y cada entrante se persiste, que es lo que alimenta la bandeja.
    expect(mocks.guardarMensajeEntrante).toHaveBeenCalledTimes(1);

    const result = await response.json();
    expect(result).toMatchObject({
      ok: true,
      statuses: 3,
      applied: 3,
      inbound: 1,
      inboundReplied: 1,
      inboundFailed: 0,
    });
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain(WEBHOOK_SECRET);
    expect(rendered).not.toContain("593991234567");
    expect(rendered).not.toContain("contenido que no debe persistirse");
  });
});
