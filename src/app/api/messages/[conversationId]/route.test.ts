import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const service = vi.hoisted(() => ({ listMessages: vi.fn() }));
const production = vi.hoisted(() => ({ createService: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/session", () => auth);
vi.mock("@/features/messages/production-direct-message-service", () => ({
  createProductionDirectMessageService: production.createService,
}));

import { GET } from "./route";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("direct message cursor route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue({ onboardingComplete: true });
    production.createService.mockResolvedValue(service);
    service.listMessages.mockResolvedValue({
      status: "loaded",
      messages: [{ id: "9007199254740993" }],
    });
  });

  it("authenticates and backfills after an arbitrary-size bigint cursor", async () => {
    const response = await GET(
      new Request(
        `https://coursemate.test/api/messages/${CONVERSATION_ID}?after=9007199254740992`,
      ),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      messages: [{ id: "9007199254740993" }],
      hasMore: false,
    });
    expect(service.listMessages).toHaveBeenCalledWith(CONVERSATION_ID, {
      direction: "after",
      cursor: "9007199254740992",
      limit: 100,
    });
  });

  it("rejects unauthenticated and tampered route input before data access", async () => {
    auth.getCurrentMember.mockResolvedValue(null);
    const unauthorized = await GET(
      new Request("https://coursemate.test/api/messages/nope?after=1"),
      { params: Promise.resolve({ conversationId: "nope" }) },
    );
    expect(unauthorized.status).toBe(401);

    auth.getCurrentMember.mockResolvedValue({ onboardingComplete: true });
    const invalid = await GET(
      new Request(`https://coursemate.test/api/messages/${CONVERSATION_ID}?after=1.5`),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) },
    );
    expect(invalid.status).toBe(400);
    expect(production.createService).not.toHaveBeenCalled();
  });
});
