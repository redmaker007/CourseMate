import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));

import type { CurrentMember } from "@/features/auth/session";

import { getCourseMessagesAfter, getCourseRoom } from "./queries";

type Result = { data: unknown; error: unknown };
type QueryCall = {
  table: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
};
type Handler = (call: QueryCall) => Result | Promise<Result>;

const ok = (data: unknown): Result => ({ data, error: null });
const failure = (message: string): Result => ({ data: null, error: new Error(message) });

const MEMBER: CurrentMember = {
  userId: "me",
  schoolId: "uw-madison",
  email: "me@wisc.edu",
  onboardingComplete: true,
};

const COURSE = {
  id: "course-1",
  school_id: "uw-madison",
  code: "CS 400",
  title: "Programming III",
  term: "2026-fall",
};

const RELATIONSHIPS = [
  {
    member_id: "bob",
    relationship_status: "friend",
    restriction_status: "none",
    send_status: "allowed",
    conversation_id: "dm-1",
  },
  {
    member_id: "cara",
    relationship_status: "none",
    restriction_status: "none",
    send_status: null,
    conversation_id: null,
  },
];

function defaultHandlers(): Record<string, Handler> {
  return {
    course_members: () => ok({ course_id: "course-1" }),
    courses: () => ok(COURSE),
    course_conversations: () => ok({ conversation_id: "conv-1" }),
    conversations: () => ok({ archived_at: null }),
    conversation_members: () =>
      ok([{ user_id: "me" }, { user_id: "bob" }, { user_id: "cara" }]),
    profiles: (call) =>
      ok(
        (call.in.id as string[]).map((id) => ({
          id,
          display_name: id.toUpperCase(),
          avatar_url: null,
        })),
      ),
    messages: () =>
      ok([
        { id: 2, sender_id: "bob", body: "second", created_at: "t2", client_message_id: null },
        { id: 1, sender_id: "me", body: "first", created_at: "t1", client_message_id: null },
      ]),
  };
}

function fakeSupabase(
  overrides: Partial<Record<string, Handler>> = {},
  rpc: (name: string, args: unknown) => Result | Promise<Result> = () =>
    ok(RELATIONSHIPS),
) {
  const handlers = { ...defaultHandlers(), ...overrides } as Record<string, Handler>;
  const started: string[] = [];

  const client = {
    from(table: string) {
      const call: QueryCall = { table, eq: {}, in: {} };
      const builder: Record<string, unknown> = {};
      const chain =
        (record?: (...args: unknown[]) => void) =>
        (...args: unknown[]) => {
          record?.(...args);
          return builder;
        };
      builder.select = chain();
      builder.eq = chain((column, value) => {
        call.eq[String(column)] = value;
      });
      builder.in = chain((column, values) => {
        call.in[String(column)] = values as unknown[];
      });
      builder.order = chain();
      builder.limit = chain();
      builder.gt = chain();
      builder.lt = chain();
      builder.maybeSingle = chain();
      // 被 await 的那一刻才算这个查询"开始"，Promise.all 会立即订阅每一路。
      builder.then = (
        resolve: (value: Result) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        started.push(table);
        return Promise.resolve(handlers[table](call)).then(resolve, reject);
      };
      return builder;
    },
    rpc(name: string, args: unknown) {
      started.push(`rpc:${name}`);
      return Promise.resolve(rpc(name, args));
    },
  };

  db.client = client;
  return { started };
}

/** 每一路都要等到 count 路全部开始才会返回；串行发起会永远等不到，测试因超时失败。 */
function barrier(count: number) {
  const names = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    names,
    wait(name: string) {
      names.add(name);
      if (names.size === count) release();
      return gate;
    },
  };
}

describe("getCourseRoom", () => {
  beforeEach(() => {
    db.client = undefined;
  });

  it("组装课程、成员（含好友关系）与最近消息", async () => {
    fakeSupabase();

    const room = await getCourseRoom(MEMBER, "course-1");

    expect(room).toEqual({
      course: {
        id: "course-1",
        schoolId: "uw-madison",
        code: "CS 400",
        title: "Programming III",
        term: "2026-fall",
        conversationId: "conv-1",
        archived: false,
        memberCount: 3,
      },
      members: [
        {
          userId: "me",
          displayName: "ME",
          avatarUrl: null,
          relationshipStatus: "self",
          restrictionStatus: null,
          sendStatus: null,
          conversationId: null,
        },
        {
          userId: "bob",
          displayName: "BOB",
          avatarUrl: null,
          relationshipStatus: "friend",
          restrictionStatus: "none",
          sendStatus: "allowed",
          conversationId: "dm-1",
        },
        {
          userId: "cara",
          displayName: "CARA",
          avatarUrl: null,
          relationshipStatus: "none",
          restrictionStatus: "none",
          sendStatus: null,
          conversationId: null,
        },
      ],
      messages: [
        {
          id: "1",
          clientMessageId: null,
          senderId: "me",
          senderName: "ME",
          body: "first",
          createdAt: "t1",
        },
        {
          id: "2",
          clientMessageId: null,
          senderId: "bob",
          senderName: "BOB",
          body: "second",
          createdAt: "t2",
        },
      ],
      hasOlderMessages: false,
    });
  });

  it("不是课程成员时返回 null，且不读取名单、关系与消息", async () => {
    const { started } = fakeSupabase({ course_members: () => ok(null) });

    await expect(getCourseRoom(MEMBER, "course-1")).resolves.toBeNull();

    expect(started).not.toContain("conversation_members");
    expect(started).not.toContain("messages");
    expect(started).not.toContain("rpc:list_course_member_relationships");
  });

  it("成员身份判断优先：不是成员时，即使课程查询出错也返回 null 而不是抛出", async () => {
    fakeSupabase({
      course_members: () => ok(null),
      courses: () => failure("courses unavailable"),
    });

    await expect(getCourseRoom(MEMBER, "course-1")).resolves.toBeNull();
  });

  it.each([
    ["课程不在当前学校", { courses: () => ok(null) }],
    ["课程没有会话关联", { course_conversations: () => ok(null) }],
    ["会话记录不存在", { conversations: () => ok(null) }],
  ] as const)("%s时返回 null", async (_label, overrides) => {
    fakeSupabase(overrides);

    await expect(getCourseRoom(MEMBER, "course-1")).resolves.toBeNull();
  });

  it.each([
    ["成员身份", { course_members: () => failure("boom") }],
    ["课程", { courses: () => failure("boom") }],
    ["会话关联", { course_conversations: () => failure("boom") }],
    ["会话", { conversations: () => failure("boom") }],
    ["成员名单", { conversation_members: () => failure("boom") }],
    ["成员资料", { profiles: () => failure("boom") }],
    ["最近消息", { messages: () => failure("boom") }],
  ] as const)("%s查询出错时向上抛出", async (_label, overrides) => {
    fakeSupabase(overrides);

    await expect(getCourseRoom(MEMBER, "course-1")).rejects.toThrow("boom");
  });

  it("好友关系摘要不可用时课程主体照常显示，关系入口降级", async () => {
    fakeSupabase({}, () => failure("rpc unavailable"));

    const room = await getCourseRoom(MEMBER, "course-1");

    expect(room?.messages).toHaveLength(2);
    expect(room?.members.map((member) => member.relationshipStatus)).toEqual([
      "self",
      "unavailable",
      "unavailable",
    ]);
  });

  it("成员身份、课程、会话关联三个查询同时发出，会话在其后", { timeout: 1000 }, async () => {
    const gate = barrier(3);
    const { started } = fakeSupabase({
      course_members: async () => {
        await gate.wait("membership");
        return ok({ course_id: "course-1" });
      },
      courses: async () => {
        await gate.wait("course");
        return ok(COURSE);
      },
      course_conversations: async () => {
        await gate.wait("link");
        return ok({ conversation_id: "conv-1" });
      },
    });

    await getCourseRoom(MEMBER, "course-1");

    expect([...gate.names].sort()).toEqual(["course", "link", "membership"]);
    expect(started.indexOf("conversations")).toBeGreaterThan(
      started.indexOf("course_conversations"),
    );
  });

  it("通过成员校验后，名单、好友关系摘要、最近消息同时发出", { timeout: 1000 }, async () => {
    const gate = barrier(3);
    fakeSupabase(
      {
        conversation_members: async () => {
          await gate.wait("roster");
          return ok([{ user_id: "me" }, { user_id: "bob" }]);
        },
        messages: async () => {
          await gate.wait("messages");
          return ok([]);
        },
      },
      async () => {
        await gate.wait("relationships");
        return ok([]);
      },
    );

    await getCourseRoom(MEMBER, "course-1");

    expect([...gate.names].sort()).toEqual(["messages", "relationships", "roster"]);
  });

  it("成员资料仍然要等名单：先查名单，再按名单里的人查资料", async () => {
    const { started } = fakeSupabase();

    await getCourseRoom(MEMBER, "course-1");

    const rosterAt = started.indexOf("conversation_members");
    const firstProfilesAt = started.indexOf("profiles");
    expect(rosterAt).toBeGreaterThan(-1);
    expect(firstProfilesAt).toBeGreaterThan(rosterAt);
  });
});

describe("getCourseMessagesAfter", () => {
  it("同样先通过并行的成员校验，再取新消息", async () => {
    const gate = barrier(3);
    fakeSupabase({
      course_members: async () => {
        await gate.wait("membership");
        return ok({ course_id: "course-1" });
      },
      courses: async () => {
        await gate.wait("course");
        return ok(COURSE);
      },
      course_conversations: async () => {
        await gate.wait("link");
        return ok({ conversation_id: "conv-1" });
      },
      // after 查询由数据库按升序返回，代码不再反转。
      messages: () =>
        ok([
          { id: 1, sender_id: "me", body: "first", created_at: "t1", client_message_id: null },
          { id: 2, sender_id: "bob", body: "second", created_at: "t2", client_message_id: null },
        ]),
    });

    const result = await getCourseMessagesAfter(MEMBER, "course-1", "0");

    expect(result?.messages.map((message) => message.id)).toEqual(["1", "2"]);
    expect(result?.hasMore).toBe(false);
  });

  it("不是课程成员时返回 null", async () => {
    fakeSupabase({ course_members: () => ok(null) });

    await expect(getCourseMessagesAfter(MEMBER, "course-1", "0")).resolves.toBeNull();
  });
});
