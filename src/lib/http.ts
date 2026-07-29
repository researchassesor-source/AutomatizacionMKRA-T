export class PayloadTooLargeError extends Error {
  constructor() {
    super("PAYLOAD_TOO_LARGE");
  }
}

export async function readJsonBody(request: Request, maximumBytes: number): Promise<unknown> {
  return JSON.parse(await readTextBody(request, maximumBytes));
}

export async function readTextBody(request: Request, maximumBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new PayloadTooLargeError();
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new PayloadTooLargeError();
  }
  return text;
}
