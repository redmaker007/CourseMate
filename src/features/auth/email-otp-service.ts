export type EmailCodeRequestResult =
  | { status: "code_sent" }
  | { status: "already_signed_in" }
  | { status: "invalid_email" }
  | { status: "rate_limited" }
  | { status: "send_failed" }
  | { status: "temporarily_unavailable" };

export type AuthCodeRequestResult =
  | { status: "accepted" }
  | { status: "rate_limited" }
  | { status: "delivery_failed" }
  | { status: "unavailable" };

export interface EmailOtpAuthPort {
  requestCode(email: string): Promise<AuthCodeRequestResult>;
}

export interface MemberSessionPort {
  hasValidMemberSession(): Promise<boolean>;
}

export interface SchoolDirectoryPort {
  matchesEnabledSchool(schoolId: string, domain: string): Promise<boolean>;
}

export type EmailOtpServiceDependencies = {
  auth: EmailOtpAuthPort;
  memberSession: MemberSessionPort;
  schools: SchoolDirectoryPort;
};

function isCommonEmailLocalPart(value: string) {
  return (
    value.length <= 64 &&
    !value.startsWith(".") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(value)
  );
}

export function createEmailOtpService(dependencies: EmailOtpServiceDependencies) {
  return {
    async requestEmailCode(
      schoolId: string,
      email: string,
    ): Promise<EmailCodeRequestResult> {
      try {
        if (await dependencies.memberSession.hasValidMemberSession()) {
          return { status: "already_signed_in" };
        }

        const trimmedEmail = email.trim();
        const at = trimmedEmail.lastIndexOf("@");
        const localPart = trimmedEmail.slice(0, at);
        const domain = trimmedEmail.slice(at + 1).toLowerCase();

        if (
          !schoolId ||
          at <= 0 ||
          at !== trimmedEmail.indexOf("@") ||
          /\s/.test(trimmedEmail) ||
          !domain ||
          trimmedEmail.length > 254 ||
          !isCommonEmailLocalPart(localPart)
        ) {
          return { status: "invalid_email" };
        }

        if (
          !(await dependencies.schools.matchesEnabledSchool(schoolId, domain))
        ) {
          return { status: "invalid_email" };
        }

        const authResult = await dependencies.auth.requestCode(
          `${localPart}@${domain}`,
        );

        switch (authResult.status) {
          case "accepted":
            return { status: "code_sent" };
          case "rate_limited":
            return { status: "rate_limited" };
          case "delivery_failed":
            return { status: "send_failed" };
          case "unavailable":
            return { status: "temporarily_unavailable" };
        }
      } catch {
        return { status: "temporarily_unavailable" };
      }
    },
  };
}
