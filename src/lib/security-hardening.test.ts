import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
const dbMocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: dbMocks.queryRaw } }));
import { canRecommendLegacyDisable, legacyConfigurationState } from "./legacy-auth-assessment";
import { checkRateLimit } from "./rate-limit";
import { canDeleteLocalSocialPost } from "./social/orchestrator";

afterEach(() => {
  vi.unstubAllEnvs();
  dbMocks.queryRaw.mockReset();
});

describe("endurecimiento compatible", () => {
  it("no desactiva implícitamente el login heredado", () => {
    const state = legacyConfigurationState({ ADMIN_PASSWORD: "configured-for-test" } as unknown as NodeJS.ProcessEnv);
    expect(state).toBe("IMPLICITLY_ENABLED");
    expect(canRecommendLegacyDisable({ state, activeAdmins: 1, recentLegacyLogins: 0 })).toBe(true);
    expect(canRecommendLegacyDisable({ state, activeAdmins: 1, recentLegacyLogins: 2 })).toBe(false);
  });

  it("solo elimina localmente borradores o simulaciones sin ID externo", () => {
    expect(canDeleteLocalSocialPost("BORRADOR", null)).toBe(true);
    expect(canDeleteLocalSocialPost("SIMULADO", null)).toBe(true);
    expect(canDeleteLocalSocialPost("PUBLICADO", null)).toBe(false);
    expect(canDeleteLocalSocialPost("BORRADOR", "provider-1")).toBe(false);
  });

  it("usa un hash irreversible como clave del límite distribuido", async () => {
    vi.stubEnv("RATE_LIMIT_MODE", "database");
    dbMocks.queryRaw.mockResolvedValue([{ count: 1, resetAt: new Date(Date.now() + 60_000) }]);
    await expect(checkRateLimit("lead-capture:203.0.113.8", { limit: 5, windowMs: 60_000 })).resolves.toMatchObject({ allowed: true, distributed: true });
    const persistedKey = dbMocks.queryRaw.mock.calls[0]?.[1];
    expect(persistedKey).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedKey).not.toContain("203.0.113.8");
  });

  it("el workflow falla en HTTP y exige main como rama operativa", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/automation-cron.yml", import.meta.url), "utf8");
    expect(workflow).toContain("--fail-with-body");
    expect(workflow).toContain('DEFAULT_BRANCH" != "main"');
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("las APIs sociales no aceptan accessToken", () => {
    const createRoute = readFileSync(new URL("../app/api/admin/social/accounts/route.ts", import.meta.url), "utf8");
    const updateRoute = readFileSync(new URL("../app/api/admin/social/accounts/[id]/route.ts", import.meta.url), "utf8");
    expect(createRoute).not.toContain("accessToken:");
    expect(updateRoute).not.toContain("accessToken:");
  });
});
