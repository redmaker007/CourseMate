export type ProfileMember = {
  userId: string;
};

export type ProfileDraft = {
  displayName: string;
  major: string;
  gradYear: string;
};

export type SavedProfile = {
  userId: string;
  displayName: string;
  major: string | null;
  gradYear: number | null;
};

export interface ProfileServiceDependencies {
  getCurrentMember(): Promise<ProfileMember | null>;
  saveOwnProfile(profile: SavedProfile): Promise<void>;
}

export type ProfileFieldErrors = Partial<
  Record<keyof ProfileDraft, string>
>;

export function createProfileService(dependencies: ProfileServiceDependencies) {
  return {
    async saveProfile(draft: ProfileDraft) {
      let member: ProfileMember | null;
      try {
        member = await dependencies.getCurrentMember();
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }
      if (!member) return { status: "unauthenticated" } as const;

      const displayName = draft.displayName.trim();
      const major = draft.major.trim();
      const gradYearInput = draft.gradYear.trim();
      const fieldErrors: ProfileFieldErrors = {};

      if (!displayName) {
        fieldErrors.displayName = "请填写显示名称。";
      } else if (Array.from(displayName).length > 15) {
        fieldErrors.displayName = "显示名称最多 15 个字符。";
      }
      if (Array.from(major).length > 80) {
        fieldErrors.major = "专业最多 80 个字符。";
      }

      const gradYear = gradYearInput ? Number(gradYearInput) : null;
      if (
        gradYearInput &&
        (!/^\d{4}$/.test(gradYearInput) ||
          gradYear === null ||
          gradYear < 2020 ||
          gradYear > 2040)
      ) {
        fieldErrors.gradYear = "请输入 2020–2040 之间的毕业年份。";
      }

      if (Object.keys(fieldErrors).length > 0) {
        return {
          status: "invalid",
          fieldErrors,
        } as const;
      }

      try {
        await dependencies.saveOwnProfile({
          userId: member.userId,
          displayName,
          major: major || null,
          gradYear,
        });
      } catch {
        return { status: "temporarily_unavailable" } as const;
      }

      return { status: "saved" } as const;
    },
  };
}
