import type { TikTokBusinessConfig } from "./config";

export const TIKTOK_BUSINESS_API = "https://business-api.tiktok.com/open_api/v1.3";
const REQUEST_TIMEOUT_MS = 15_000;

type BusinessEnvelope<T> = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
};

export type BusinessResult<T> =
  | { ok: true; data: T; requestId: string | null }
  | { ok: false; errorCode: string; error: string; requestId: string | null };

function safeProviderMessage(message: unknown): string {
  if (typeof message !== "string" || !message.trim()) return "TikTok Business rechazó la solicitud.";
  return message.replace(/(?:token|secret|authorization|cookie)\s*[:=]\s*\S+/gi, "dato sensible=[oculto]").slice(0, 300);
}

export async function businessRequest<T>(input: {
  path: string;
  method?: "GET" | "POST";
  accessToken?: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  fetcher?: typeof fetch;
}): Promise<BusinessResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const fetcher = input.fetcher ?? fetch;
  try {
    const url = new URL(`${TIKTOK_BUSINESS_API}${input.path}`);
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);
    const response = await fetcher(url, {
      method: input.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(input.accessToken ? { "Access-Token": input.accessToken } : {}),
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as BusinessEnvelope<T>;
    const requestId = typeof payload.request_id === "string" ? payload.request_id.slice(0, 120) : null;
    if (!response.ok || payload.code !== 0 || payload.data === undefined) {
      return {
        ok: false,
        errorCode: String(payload.code ?? `HTTP_${response.status}`).slice(0, 120),
        error: safeProviderMessage(payload.message),
        requestId,
      };
    }
    return { ok: true, data: payload.data, requestId };
  } catch (error) {
    return {
      ok: false,
      errorCode: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
      error: error instanceof Error && error.name === "AbortError"
        ? "TikTok Business no respondió dentro del tiempo permitido."
        : "No se pudo contactar con TikTok Business.",
      requestId: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function requireBusinessCredentials(config: TikTokBusinessConfig): { appId: string; secret: string } | null {
  return config.appId && config.secret ? { appId: config.appId, secret: config.secret } : null;
}
