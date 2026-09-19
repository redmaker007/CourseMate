// 教学练习：只演示“关系状态 -> 页面显示”，不被生产代码引用。
// TypeScript 可以理解成“带类型检查的 JavaScript”。这里的 type 只负责
// 约束允许出现的值，不会在程序运行时产生额外数据。

// 竖线 | 表示“几种值中的一种”；例如这里不允许写成 "best_friend"。
type Relationship = "none" | "outgoing_request" | "incoming_request" | "friend";
type SendStatus = "allowed" | "blocked" | "readonly" | null;

// MemberState 是输入：数据库告诉页面的事实。
type MemberState = {
  relationship: Relationship;
  restricted: boolean;
  conversationId: string | null;
  sendStatus: SendStatus;
};

// Presentation 是输出：页面最终显示的内容和允许的操作。
type Presentation = {
  statusText: string;
  actionLabel: string | null;
  actionHref: string | null;
  composerEnabled: boolean;
};

// 返回类型 Presentation 保证每个分支都必须返回完整、类型正确的结果。
function derivePresentation(state: MemberState): Presentation {
  // 好友和发送受限可以同时成立，所以先处理好友；受限时仍能查看历史。
  if (state.relationship === "friend") {
    // 好友理论上应有私聊 ID。缺失时安全失败，不生成无效链接。
    if (!state.conversationId) {
      return {
        statusText: "好友数据异常",
        actionLabel: null,
        actionHref: null,
        composerEnabled: false,
      };
    }

    return {
      statusText: "已是好友",
      actionLabel: "发消息",
      actionHref: `/messages/${state.conversationId}`,
      // === 是严格相等判断，结果是 true 或 false。
      composerEnabled: state.sendStatus === "allowed",
    };
  }

  // 走到这里已经确定不是好友；受限制时不能显示“添加好友”。
  if (state.restricted) {
    return {
      statusText: "当前无法添加",
      actionLabel: null,
      actionHref: null,
      composerEnabled: false,
    };
  }

  // 已有待处理申请时不能创建第二份申请。
  if (state.relationship === "outgoing_request") {
    return {
      statusText: "申请已发送",
      actionLabel: null,
      actionHref: null,
      composerEnabled: false,
    };
  }

  if (state.relationship === "incoming_request") {
    return {
      statusText: "对方向你发来了申请",
      actionLabel: "处理申请",
      actionHref: "/friends",
      composerEnabled: false,
    };
  }

  // 前面的情况都不匹配，只剩普通非好友。
  return {
    statusText: "",
    actionLabel: "添加好友",
    actionHref: "/friends/add",
    composerEnabled: false,
  };
}

// 手工构造一份输入，调用函数，并保存输出。
const friend = derivePresentation({
  relationship: "friend",
  restricted: false,
  conversationId: "demo-conversation",
  sendStatus: "allowed",
});

// console.assert 是最小自检：条件为 false 时，运行程序会报告失败。
console.assert(friend.statusText === "已是好友");
console.assert(friend.actionHref === "/messages/demo-conversation");
console.assert(friend.composerEnabled);
console.log(friend);
