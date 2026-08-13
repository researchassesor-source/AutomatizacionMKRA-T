// Contrato comun para todas las redes sociales.
// Cada red implementa este adaptador; el orquestador no necesita saber
// los detalles de cada API.

export type Platform =
  | "INSTAGRAM"
  | "FACEBOOK"
  | "TIKTOK"
  | "YOUTUBE"
  | "LINKEDIN";

export interface PublishInput {
  caption: string;
  mediaUrl?: string;
  mediaType?: "IMAGE" | "VIDEO";
  linkUrl?: string;
  externalPostId?: string;
  providerStatus?: string;
  providerState?: Record<string, string | number | boolean | null>;
}

export interface PublishResult {
  ok: boolean;
  externalPostId?: string;
  providerPostUrl?: string;
  accepted?: boolean;
  providerStatus?: string;
  providerResponse?: Record<string, string | number | boolean | null>;
  errorCode?: string;
  error?: string;
}

export interface SocialAdapter {
  readonly platform: Platform;
  /** Indica si el adaptador tiene credenciales configuradas. */
  isConfigured(): boolean;
  /** Publica el contenido en la red social. */
  publish(input: PublishInput): Promise<PublishResult>;
}
