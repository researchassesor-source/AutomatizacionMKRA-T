import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import HomePage from "./page";

describe("ruta inicial del CRM", () => {
  beforeEach(() => redirectMock.mockClear());

  it("redirige en servidor directamente al login administrativo", () => {
    HomePage();
    expect(redirectMock).toHaveBeenCalledExactlyOnceWith("/admin/login");
  });
});
