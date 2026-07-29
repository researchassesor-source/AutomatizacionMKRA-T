import { describe, expect, it } from "vitest";
import { PayloadTooLargeError, readJsonBody } from "./http";

describe("límites de payload JSON", () => {
  it("acepta un JSON pequeño", async () => {
    const body = await readJsonBody(new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    }), 100);
    expect(body).toEqual({ ok: true });
  });

  it("rechaza por Content-Length antes de leer", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: "{}",
    });
    await expect(readJsonBody(request, 100)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("rechaza cuerpos reales mayores al límite aunque no declaren longitud", async () => {
    const request = new Request("http://localhost/test", { method: "POST", body: JSON.stringify({ text: "x".repeat(200) }) });
    await expect(readJsonBody(request, 100)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});
