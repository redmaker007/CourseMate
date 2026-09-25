export type MemberSession = {
  userId: string;
  schoolId: string;
};

export type VerifiedAuthUser = {
  id: string;
  email: string;
};

/** 数据库一次调用返回的成员事实；没有成员账号时端口返回 null。 */
export type MemberFacts = {
  userId: string;
  /** 成员账号绑定的学校（邮箱归属）。 */
  homeSchoolId: string;
  /** 已验证邮箱的域名对应的开放学校；域名未开放时为 null。 */
  enabledSchoolId: string | null;
  /** 业务上的当前学校；管理员跨校测试时与 homeSchoolId 不同。 */
  currentSchoolId: string | null;
  onboardingComplete: boolean;
};

export type MemberContext = {
  userId: string;
  email: string;
  homeSchoolId: string;
  currentSchoolId: string;
  onboardingComplete: boolean;
};

export interface MemberSessionDataPort {
  getVerifiedUser(): Promise<VerifiedAuthUser | null>;
  /** 一次往返取回全部成员事实，避免为同一次校验串行发起多次请求。 */
  getMemberFacts(emailDomain: string): Promise<MemberFacts | null>;
}

export function createMemberSessionReader(data: MemberSessionDataPort) {
  /**
   * 有效成员会话 = Auth 用户存在，且成员账号存在、绑定与用户一致，且邮箱域名仍对应
   * 这所已开放的学校。任何一项不满足都当作未登录。
   */
  async function readValidFacts() {
    const user = await data.getVerifiedUser();
    if (!user) return null;

    const at = user.email.lastIndexOf("@");
    if (at <= 0 || at !== user.email.indexOf("@")) return null;

    const facts = await data.getMemberFacts(
      user.email.slice(at + 1).toLowerCase(),
    );
    if (!facts || facts.userId !== user.id) return null;
    if (!facts.enabledSchoolId || facts.enabledSchoolId !== facts.homeSchoolId) {
      return null;
    }

    return { user, facts };
  }

  return {
    async getMemberSession(): Promise<MemberSession | null> {
      const valid = await readValidFacts();
      if (!valid) return null;

      return { userId: valid.user.id, schoolId: valid.facts.homeSchoolId };
    },

    /** 给页面用：在有效会话之上，再带上邮箱、当前学校与 onboarding 状态。 */
    async getMemberContext(): Promise<MemberContext | null> {
      const valid = await readValidFacts();
      // 读不到当前学校与读不到 onboarding 状态一样，按未登录处理（fail closed）。
      if (!valid || !valid.facts.currentSchoolId) return null;

      return {
        userId: valid.user.id,
        email: valid.user.email,
        homeSchoolId: valid.facts.homeSchoolId,
        currentSchoolId: valid.facts.currentSchoolId,
        onboardingComplete: valid.facts.onboardingComplete,
      };
    },
  };
}
