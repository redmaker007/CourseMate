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

const ROOM = {
  course: COURSE,
  conversation_id: "conv-1",
  archived: false,
  members: [
    { user_id: "me", display_name: "ME", avatar_url: null },
    { user_id: "bob", display_name: "BOB", avatar_url: null },
    { user_id: "cara", display_name: "CARA", avatar_url: null },
  ],
  messages: [
    { id: 1, sender_id: "me", sender_name: "ME", body: "first", created_at: "t1", client_message_id: null },
    { id: 2, sender_id: "bob", sender_name: "BOB", body: "second", created_at: "t2", client_message_id: null },
  ],
};

/** getCourseRoom 只调用两个 RPC：get_course_room 与好友关系摘要。 */
function roomRpc(
  room: () => Result | Promise<Result> = () => ok(ROOM),
  relationships: () => Result | Promise<Result> = () => ok(RELATIONSHIPS),
) {
  return (name: string) =>
    name === "get_course_room" ? room() : relationships();
}

describe("getCourseRoom", () => {
  beforeEach(() => {
    db.client = undefined;
  });

  it("组装课程、成员（含好友关系）与最近消息", async () => {
    fakeSupabase({}, roomRpc());

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

  it("只发出两个数据库调用，且把课程、学校和消息条数传给函数", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const { started } = fakeSupabase({}, (name, args) => {
      calls.push({ name, args });
      return roomRpc()(name);
    });

    await getCourseRoom(MEMBER, "course-1");

    expect([...started].sort()).toEqual([
      "rpc:get_course_room",
      "rpc:list_course_member_relationships",
    ]);
    expect(calls.find((call) => call.name === "get_course_room")?.args).toEqual({
      target_course: "course-1",
      target_school: "uw-madison",
      message_limit: 50,
    });
  });

  it("课程主体与好友关系摘要同时发出", { timeout: 1000 }, async () => {
    const gate = barrier(2);
    fakeSupabase(
      {},
      roomRpc(
        async () => {
          await gate.wait("room");
          return ok(ROOM);
        },
        async () => {
          await gate.wait("relationships");
          return ok([]);
        },
      ),
    );

    await getCourseRoom(MEMBER, "course-1");

    expect([...gate.names].sort()).toEqual(["relationships", "room"]);
  });

  it("函数返回空（不是成员、课程不在当前学校、没有会话关联等）时返回 null", async () => {
    fakeSupabase({}, roomRpc(() => ok(null)));

    await expect(getCourseRoom(MEMBER, "course-1")).resolves.toBeNull();
  });

  it("不是成员时即使好友关系摘要出错也返回 null 而不是抛出", async () => {
    fakeSupabase(
      {},
      roomRpc(
        () => ok(null),
        () => failure("rpc unavailable"),
      ),
    );

    await expect(getCourseRoom(MEMBER, "course-1")).resolves.toBeNull();
  });

  it("课程函数出错时向上抛出", async () => {
    fakeSupabase({}, roomRpc(() => failure("boom")));

    await expect(getCourseRoom(MEMBER, "course-1")).rejects.toThrow("boom");
  });

  it("好友关系摘要不可用时课程主体照常显示，关系入口降级", async () => {
    fakeSupabase({}, roomRpc(() => ok(ROOM), () => failure("rpc unavailable")));

    const room = await getCourseRoom(MEMBER, "course-1");

    expect(room?.messages).toHaveLength(2);
    expect(room?.members.map((member) => member.relationshipStatus)).toEqual([
      "self",
      "unavailable",
      "unavailable",
    ]);
  });

  it("读不到昵称或发送者已注销时沿用原来的兜底文案", async () => {
    fakeSupabase(
      {},
      roomRpc(() =>
        ok({
          ...ROOM,
          members: [
            { user_id: "me", display_name: null, avatar_url: null },
            { user_id: "bob", display_name: "BOB", avatar_url: "a.png" },
          ],
          messages: [
            { id: "7", sender_id: "bob", sender_name: null, body: "x", created_at: "t", client_message_id: "c1" },
            { id: "8", sender_id: null, sender_name: null, body: "y", created_at: "t", client_message_id: null },
          ],
        }),
      ),
    );

    const room = await getCourseRoom(MEMBER, "course-1");

    expect(room?.members.map((member) => [member.displayName, member.avatarUrl])).toEqual([
      ["成员", null],
      ["BOB", "a.png"],
    ]);
    expect(room?.messages.map((message) => [message.id, message.senderName, message.clientMessageId])).toEqual([
      ["7", "成员", "c1"],
      ["8", "已注销用户", null],
    ]);
  });

  it("消息正好 50 条时标记还有更早的消息，已归档的课程保留归档标记", async () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      sender_id: "me",
      sender_name: "ME",
      body: "m",
      created_at: "t",
      client_message_id: null,
    }));
    fakeSupabase({}, roomRpc(() => ok({ ...ROOM, archived: true, messages })));

    const room = await getCourseRoom(MEMBER, "course-1");

    expect(room?.hasOlderMessages).toBe(true);
    expect(room?.course.archived).toBe(true);
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
