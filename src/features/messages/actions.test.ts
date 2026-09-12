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
const CLIENT_MESSAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAVED_MESSAGE = {
  id: "42",
  conversationId: CONVERSATION_ID,
  senderId: "member-1",
  senderDisplayName: "Alice",
  body: "hello",
  createdAt: "2026-09-12T00:00:00Z",
};

describe("direct message server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getCurrentMember.mockResolvedValue({ onboardingComplete: true });
    production.createService.mockResolvedValue(service);
  });

  it("sends through the authenticated service and returns the inserted id", async () => {
    service.sendMessage.mockResolvedValue({
      status: "sent",
      message: SAVED_MESSAGE,
    });
    const form = new FormData();
    form.set("conversationId", CONVERSATION_ID);
    form.set("clientMessageId", CLIENT_MESSAGE_ID);
    form.set("body", " hello ");

    await expect(
      sendDirectMessageAction(initialDirectMessageActionState, form),
    ).resolves.toMatchObject({
      status: "sent",
      clientMessageId: CLIENT_MESSAGE_ID,
      attemptedBody: " hello ",
      savedMessage: SAVED_MESSAGE,
    });
    expect(service.sendMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      CLIENT_MESSAGE_ID,
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

  it("lets the unified database boundary reject an incomplete sender", async () => {
    service.sendMessage.mockResolvedValue({ status: "onboarding_required" });
    const form = new FormData();
    form.set("conversationId", CONVERSATION_ID);
    form.set("clientMessageId", CLIENT_MESSAGE_ID);
    form.set("body", "hello");

    await expect(
      sendDirectMessageAction(initialDirectMessageActionState, form),
    ).resolves.toMatchObject({
      status: "onboarding_required",
      clientMessageId: CLIENT_MESSAGE_ID,
      attemptedBody: "hello",
    });
    expect(auth.getCurrentMember).not.toHaveBeenCalled();
  });
});
