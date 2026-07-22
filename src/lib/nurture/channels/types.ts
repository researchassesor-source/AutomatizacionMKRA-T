// Contrato comun para los canales de mensajeria del nurture.
// Igual que en redes sociales: el motor no conoce los detalles de cada
// proveedor, solo pide send().

export type Channel = "EMAIL" | "WHATSAPP";

export interface SendInput {
  to: string;
  subject?: string;
  body: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface MessageChannelAdapter {
  readonly channel: Channel;
  /** Indica si hay credenciales configuradas para enviar de verdad. */
  isConfigured(): boolean;
  send(input: SendInput): Promise<SendResult>;
}
