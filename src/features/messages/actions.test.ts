import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const service = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  markRead: vi.fn(),
  clearConversation: vi.fn(),
}));
const production = vi.hoisted(() => ({ createService: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/features/auth/session", () => auth);
vi.mock("./production-direct-message-service", () => ({
  createProductionDirectMessageService: production.createService,
}));

import {
  clearDirectConversationAction,
  markDirectMessageReadAction,
  sendDirectMessageAction,
} from "./actions";
import { initialDirectMessageActionState } from "./message-action-state";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("direct message server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue({ onboardingComplete: true });
    production.createService.mockResolvedValue(service);
  });

  it("sends through the authenticated service and returns the inserted id", async () => {
    service.sendMessage.mockResolvedValue({ status: "sent", messageId: "42" });
    const form = new FormData();
    form.set("conversationId", CONVERSATION_ID);
    form.set("body", " hello ");

    await expect(
      sendDirectMessageAction(initialDirectMessageActionState, form),
    ).resolves.toMatchObject({ status: "sent", messageId: "42" });
    expect(service.sendMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      " hello ",
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith(
      `/messages/${CONVERSATION_ID}`,
    );
  });

  it("does not trust read or clear identifiers supplied by the browser", async () => {
    service.markRead.mockResolvedValue({ status: "invalid_conversation" });
    service.clearConversation.mockResolvedValue({ status: "not_available" });

    await expect(markDirectMessageReadAction("tampered", "99")).resolves.toBe(
      "invalid_conversation",
    );
    const form = new FormData();
    form.set("conversationId", CONVERSATION_ID);
    form.set("throughMessageId", "99");
    await expect(
      clearDirectConversationAction(initialDirectMessageActionState, form),
    ).resolves.toMatchObject({
      status: "not_available",
      throughMessageId: "99",
    });
  });

  it("rejects mutation attempts without a complete member session", async () => {
    auth.getCurrentMember.mockResolvedValue(null);
    const form = new FormData();
    form.set("conversationId", CONVERSATION_ID);
    form.set("body", "hello");

    await expect(
      sendDirectMessageAction(initialDirectMessageActionState, form),
    ).resolves.toMatchObject({ status: "unauthorized" });
    expect(production.createService).not.toHaveBeenCalled();
  });
});
