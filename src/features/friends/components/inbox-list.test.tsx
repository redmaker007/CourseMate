// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ usePathname: vi.fn(() => "/friends") }));
vi.mock("next/navigation", () => navigation);

import { defaultInboxTab, InboxList } from "./inbox-list";
import { InboxShell } from "./inbox-shell";

const DATA = {
  conversations: [
    { conversationId: "c-bob", memberId: "m-bob", name: "Bob", subtitle: "CS 300 · MATH 221", unread: 3, blocked: false },
    { conversationId: "c-amy", memberId: "m-amy", name: "Amy", subtitle: "暂无共同课程", unread: 0, blocked: false },
  ],
  friends: [
    { memberId: "m-amy", name: "Amy", detail: "Math · 2028 届" },
    { memberId: "m-bob", name: "Bob", detail: "CS · 2027 届" },
  ],
  pendingIncoming: 2,
  unavailable: false,
};

describe("InboxList", () => {
  beforeEach(() => navigation.usePathname.mockReturnValue("/friends"));
  afterEach(cleanup);

  it("消息标签列出会话、共同课程和未读角标", () => {
    render(<InboxList {...DATA} />);

    const bob = screen.getByRole("link", { name: /Bob/ });
    expect(bob.getAttribute("href")).toBe("/messages/c-bob");
    expect(within(bob).getByText("CS 300 · MATH 221")).toBeTruthy();
    expect(within(bob).getByText("3")).toBeTruthy();
  });

  it("正在看的会话不显示未读角标", () => {
    navigation.usePathname.mockReturnValue("/messages/c-bob");
    render(<InboxList {...DATA} />);

    const bob = screen.getByRole("link", { name: /Bob/ });
    expect(bob.getAttribute("aria-current")).toBe("page");
    expect(within(bob).queryByText("3")).toBeNull();
  });

  it("按名字筛选", () => {
    render(<InboxList {...DATA} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "按名字筛选" }), {
      target: { value: "am" },
    });

    expect(screen.queryByRole("link", { name: /Bob/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Amy/ })).toBeTruthy();
  });

  it("同学标签有新的朋友（带待处理数）、屏蔽与拉黑、我的好友", () => {
    render(<InboxList {...DATA} />);
    fireEvent.click(screen.getByRole("tab", { name: /同学/ }));

    expect(screen.getByRole("link", { name: /新的朋友/ }).getAttribute("href")).toBe(
      "/friends/requests",
    );
    expect(within(screen.getByRole("link", { name: /新的朋友/ })).getByText("2")).toBeTruthy();
    expect(screen.getByRole("link", { name: /屏蔽与拉黑/ })).toBeTruthy();
    expect(screen.getByText("我的好友 · 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Bob/ }).getAttribute("href")).toBe("/friends/m-bob");
  });

  it("没有会话时引导去看同学", () => {
    render(<InboxList {...DATA} conversations={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "查看同学" }));
    expect(screen.getByRole("tab", { name: /同学/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("好友管理类页面默认停在同学标签", () => {
    expect(defaultInboxTab("/friends")).toBe("messages");
    expect(defaultInboxTab("/messages/c-bob")).toBe("messages");
    expect(defaultInboxTab("/friends/requests")).toBe("classmates");
    expect(defaultInboxTab("/friends/m-bob")).toBe("classmates");
  });
});

describe("InboxShell", () => {
  afterEach(cleanup);

  it("手机端在 /friends 只显示列表，进入会话后只显示右栏", () => {
    navigation.usePathname.mockReturnValue("/friends");
    const { rerender } = render(
      <InboxShell list={<p>列表</p>}>
        <p>右栏</p>
      </InboxShell>,
    );
    expect(screen.getByText("列表").parentElement?.className).toContain("flex");
    expect(screen.getByText("右栏").parentElement?.className).toMatch(/(^| )hidden( |$)/);

    navigation.usePathname.mockReturnValue("/messages/c-bob");
    rerender(
      <InboxShell list={<p>列表</p>}>
        <p>右栏</p>
      </InboxShell>,
    );
    expect(screen.getByText("列表").parentElement?.className).toMatch(/(^| )hidden( |$)/);
  });
});
