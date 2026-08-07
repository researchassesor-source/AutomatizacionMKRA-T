// Contrato comun para los canales de mensajeria del nurture.
// Igual que en redes sociales: el motor no conoce los detalles de cada
// proveedor, solo pide send().

export type Channel = "EMAIL" | "WHATSAPP";

export interface SendInput {
  to: string;
  subject?: string;
  body: string;
  /**
   * Plantilla aprobada con la que debe enviarse el mensaje. La usa WhatsApp:
   * un mensaje iniciado por la empresa no puede salir como texto libre porque
   * Meta lo rechaza. `components` ya viene resuelto con los valores finales.
   */
  template?: {
    name: string;
    language: string;
    components: unknown[];
  };
}

export interface SendResult {
  ok: boolean;
  error?: string;
  errorCode?: string;
  /**
   * El fallo no mejora reintentando (plantilla inexistente, token revocado,
   * número inválido). Reintentar cinco veces con el mismo token caducado solo
   * retrasa el diagnóstico, así que estos casos agotan los intentos de una vez.
   */
  permanent?: boolean;
  simulated?: boolean;
  providerName?: string;
  providerMessageId?: string;
  acceptedAt?: Date;
  providerResponse?: Record<string, string | number | boolean | null>;
}

export interface MessageChannelAdapter {
  readonly channel: Channel;
  /** Indica si hay credenciales configuradas para enviar de verdad. */
  isConfigured(): boolean;
  send(input: SendInput): Promise<SendResult>;
}
