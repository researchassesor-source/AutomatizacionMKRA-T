import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    socialPost: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  publishPost: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
  requireRole: vi.fn(async () => ({ session: { userId: "direction-qa", email: "direction@local.test", role: "DIRECCION" }, error: null })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/social/orchestrator", () => ({
  canDeleteLocalSocialPost: vi.fn(() => true),
  publishPost: mocks.publishPost,
}));

import { PATCH } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.socialPost.findUnique.mockResolvedValue({
    id: "post-failed",
    status: "FALLIDO",
    accountId: "account-1",
    caption: "Prueba",
    mediaUrl: null,
    linkUrl: null,
    scheduledAt: null,
  });
  mocks.prisma.socialPost.update.mockResolvedValue({ id: "post-failed", status: "ARCHIVADO" });
});

describe("PATCH /api/admin/social/posts/[id] archive", () => {
  it("archiva solamente el registro local y no llama al proveedor", async () => {
    const request = new Request("https://crm.example.test/api/admin/social/posts/post-failed", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive", confirm: true }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "post-failed" }) });

    expect(response.status).toBe(200);
    expect(mocks.prisma.socialPost.update).toHaveBeenCalledWith({
      where: { id: "post-failed" },
      data: { status: "ARCHIVADO", archivedAt: expect.any(Date) },
    });
    expect(mocks.publishPost).not.toHaveBeenCalled();
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "SOCIAL_POST_ARCHIVE" }));
    expect((mocks.requireRole.mock.calls as unknown[][])[0]?.[1]).toEqual(expect.arrayContaining(["ADMIN", "DIRECCION"]));
  });
});
