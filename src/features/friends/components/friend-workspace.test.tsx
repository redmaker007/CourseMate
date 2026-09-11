// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BlockedMemberListItem,
  FriendListItem,
  FriendRequestView,
} from "../friendship-service";
import {
  FilteredFriendList,
  FriendWorkspace,
} from "./friend-workspace";
import { FriendNoteForm } from "./friend-relationship-management";

const action = vi.fn(async () => ({ status: "saved", message: "已保存" }));
const searchAction = vi.fn(async () => ({
  status: "not_found" as const,
  message: "没有找到",
}));
const reportAction = vi.fn(async () => ({
  status: "created",
  message: "submitted",
}));

const FRIEND: FriendListItem = {
  memberId: "22222222-2222-4222-8222-222222222222",
  displayName: "Bob",
  effectiveName: "鲍勃",
  avatarUrl: null,
  major: "Computer Science",
  gradYear: 2027,
  sharedCourses: [{ id: "course-1", code: "CS 101", title: "Intro" }],
  hidden: false,
  sendStatus: "allowed",
  blockStatus: "none",
  conversationId: "33333333-3333-4333-8333-333333333333",
};

const REQUESTS: FriendRequestView[] = [
  {
    requestId: "44444444-4444-4444-8444-444444444444",
    direction: "incoming",
    otherMemberId: FRIEND.memberId,
    displayName: "Bob",
    avatarUrl: null,
    message: "一起学习吧",
    status: "pending",
    createdAt: "2026-09-10T00:00:00Z",
    expiresAt: "2026-09-13T00:00:00Z",
    resolvedAt: null,
  },
  {
    requestId: "55555555-5555-4555-8555-555555555555",
    direction: "outgoing",
    otherMemberId: "66666666-6666-4666-8666-666666666666",
    displayName: "Carol",
    avatarUrl: null,
    message: "Hello",
    status: "accepted",
    createdAt: "2026-09-09T00:00:00Z",
    expiresAt: "2026-09-12T00:00:00Z",
    resolvedAt: "2026-09-09T01:00:00Z",
  },
];

const BLOCKED_MEMBER: BlockedMemberListItem = {
  memberId: "77777777-7777-4777-8777-777777777777",
  displayName: "Dana",
  avatarUrl: null,
  activeFriendship: false,
  conversationId: null,
};

const BLOCKED_FRIENDS = [
  {
    blockStatus: "blocked_by_me",
    button: true,
    message: "你已拉黑对方",
  },
  {
    blockStatus: "blocked_by_other",
    button: false,
    message: "对方已拉黑你",
  },
  {
    blockStatus: "mutual",
    button: true,
    message: "双方互相拉黑",
  },
] as const;

afterEach(cleanup);

describe("friend workspace", () => {
  it("renders exact-email discovery without putting the email in a URL", () => {
    render(
      <FriendWorkspace
        friends={[FRIEND]}
        mutationAction={action}
        reportAction={reportAction}
        requests={REQUESTS}
        searchAction={searchAction}
      />,
    );

    const email = screen.getByLabelText("同校成员邮箱") as HTMLInputElement;
    expect(email.name).toBe("email");
    expect(email.form?.getAttribute("action")).not.toContain("email");
    expect(document.querySelector('input[type="hidden"][name="email"]')).toBeNull();
  });

  it("shows actionable request history and the real conversation entry", () => {
    render(
      <FriendWorkspace
        friends={[FRIEND]}
        mutationAction={action}
        reportAction={reportAction}
        requests={REQUESTS}
        searchAction={searchAction}
      />,
    );

    expect(screen.getByText("一起学习吧")).toBeTruthy();
    expect(screen.getByRole("button", { name: "接受" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy();
    expect(screen.getByText("已接受")).toBeTruthy();
    expect(screen.getByRole("link", { name: "打开会话" }).getAttribute("href"))
      .toBe(`/messages/${FRIEND.conversationId}`);
  });

  it("offers reporting for an incoming request and a visible member profile", () => {
    render(
      <FriendWorkspace
        friends={[FRIEND]}
        mutationAction={action}
        reportAction={reportAction}
        requests={REQUESTS}
        searchAction={searchAction}
      />,
    );

    expect(screen.getByRole("button", { name: "举报好友申请" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "举报成员资料" })).toBeTruthy();
  });

  it("shows unread only when the containing page supplies that conversation", () => {
    render(
      <FriendWorkspace
        friends={[FRIEND]}
        mutationAction={action}
        reportAction={reportAction}
        requests={[]}
        searchAction={searchAction}
        unreadByConversation={{ [FRIEND.conversationId]: 3 }}
      />,
    );

    expect(screen.getByText("3 条未读")).toBeTruthy();
  });

  it("counts Unicode note characters and blocks the sixteenth character", () => {
    render(<FriendNoteForm action={action} friend={FRIEND} />);
    const input = screen.getByLabelText("给鲍勃设置私有备注") as HTMLInputElement;
    const save = screen.getByRole("button", { name: "保存备注" }) as HTMLButtonElement;

    fireEvent.change(input, { target: { value: "中".repeat(15) } });
    expect(screen.getByText("15/15")).toBeTruthy();
    expect(save.disabled).toBe(false);

    fireEvent.change(input, { target: { value: "中".repeat(16) } });
    expect(screen.getByText("16/15")).toBeTruthy();
    expect(screen.getByText("备注最多 15 个字符。")).toBeTruthy();
    expect(save.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "清除备注" })).toBeTruthy();
  });

  it("explains that hide is private and removal preserves history", () => {
    render(
      <FriendWorkspace
        friends={[FRIEND]}
        mutationAction={action}
        reportAction={reportAction}
        requests={[]}
        searchAction={searchAction}
      />,
    );

    expect(screen.getByText(/屏蔽只影响你的列表/)).toBeTruthy();
    expect(screen.getByText(/不会替对方删除历史/)).toBeTruthy();
  });

  it("lets the member find and unblock a blocked non-friend", () => {
    render(
      <FilteredFriendList
        blockedMembers={[BLOCKED_MEMBER]}
        friends={[]}
        mutationAction={action}
        reportAction={reportAction}
      />,
    );

    expect(screen.getByText("Dana")).toBeTruthy();
    expect(screen.getByRole("button", { name: "解除拉黑" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "打开会话" })).toBeNull();
  });

  it.each(BLOCKED_FRIENDS)(
    "renders $blockStatus with the correct unblock capability",
    ({ blockStatus, button, message }) => {
      render(
        <FriendWorkspace
          friends={[
            {
              ...FRIEND,
              blockStatus,
              sendStatus: "blocked",
            } as FriendListItem & { blockStatus: typeof blockStatus },
          ]}
          mutationAction={action}
          reportAction={reportAction}
          requests={[]}
          searchAction={searchAction}
        />,
      );

      expect(screen.getByText(message, { exact: false })).toBeTruthy();
      expect(screen.getByText("双方不能发送消息", { exact: false })).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "解除我设置的拉黑" }) !== null,
      ).toBe(button);
    },
  );
});
