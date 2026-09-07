export type MemberSession = {
  userId: string;
  schoolId: string;
};

export type VerifiedAuthUser = {
  id: string;
  email: string;
};

export type MemberBinding = {
  userId: string;
  schoolId: string;
};

export interface MemberSessionDataPort {
  getVerifiedUser(): Promise<VerifiedAuthUser | null>;
  getMemberBinding(userId: string): Promise<MemberBinding | null>;
  getEnabledSchoolIdForDomain(domain: string): Promise<string | null>;
}

export function createMemberSessionReader(data: MemberSessionDataPort) {
  return {
    async getMemberSession(): Promise<MemberSession | null> {
      const user = await data.getVerifiedUser();
      if (!user) return null;

      const binding = await data.getMemberBinding(user.id);
      if (!binding || binding.userId !== user.id) return null;

      const at = user.email.lastIndexOf("@");
      if (at <= 0 || at !== user.email.indexOf("@")) return null;

      const schoolId = await data.getEnabledSchoolIdForDomain(
        user.email.slice(at + 1).toLowerCase(),
      );
      if (!schoolId || schoolId !== binding.schoolId) return null;

      return { userId: user.id, schoolId };
    },
  };
}
