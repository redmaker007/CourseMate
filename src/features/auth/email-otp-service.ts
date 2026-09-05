export type EmailCodeRequestResult =
  | { status: "code_sent"; schoolId: string; email: string }
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

export type EmailCodeVerificationResult =
  | { status: "signed_in" }
  | { status: "already_signed_in" }
  | { status: "invalid_email" }
  | { status: "invalid_or_expired_code" }
  | { status: "rate_limited" }
  | { status: "temporarily_unavailable" };

export type AuthCodeVerificationResult =
  | { status: "verified" }
  | { status: "invalid_or_expired" }
  | { status: "rate_limited" }
  | { status: "unavailable" };

export interface EmailOtpAuthPort {
  requestCode(email: string): Promise<AuthCodeRequestResult>;
  verifyCode(
    email: string,
    code: string,
  ): Promise<AuthCodeVerificationResult>;
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

function normalizeSchoolEmail(email: string) {
  const trimmedEmail = email.trim();
  const at = trimmedEmail.lastIndexOf("@");
  const localPart = trimmedEmail.slice(0, at);
  const domain = trimmedEmail.slice(at + 1).toLowerCase();

  if (
    at <= 0 ||
    at !== trimmedEmail.indexOf("@") ||
    /\s/.test(trimmedEmail) ||
    !domain ||
    trimmedEmail.length > 254 ||
    !isCommonEmailLocalPart(localPart)
  ) {
    return null;
  }

  return { domain, email: `${localPart}@${domain}` };
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

        const normalized = normalizeSchoolEmail(email);

        if (!schoolId || !normalized) {
          return { status: "invalid_email" };
        }

        if (
          !(await dependencies.schools.matchesEnabledSchool(
            schoolId,
            normalized.domain,
          ))
        ) {
          return { status: "invalid_email" };
        }

        const authResult = await dependencies.auth.requestCode(normalized.email);

        switch (authResult.status) {
          case "accepted":
            return {
              status: "code_sent",
              schoolId,
              email: normalized.email,
            };
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

    async verifyEmailCode(
      schoolId: string,
      email: string,
      code: string,
    ): Promise<EmailCodeVerificationResult> {
      try {
        if (await dependencies.memberSession.hasValidMemberSession()) {
          return { status: "already_signed_in" };
        }

        const normalized = normalizeSchoolEmail(email);
        const trimmedCode = code.trim();

        if (!schoolId || !normalized) {
          return { status: "invalid_email" };
        }

        if (!/^\d{6}$/.test(trimmedCode)) {
          return { status: "invalid_or_expired_code" };
        }

        if (
          !(await dependencies.schools.matchesEnabledSchool(
            schoolId,
            normalized.domain,
          ))
        ) {
          return { status: "invalid_email" };
        }

        const authResult = await dependencies.auth.verifyCode(
          normalized.email,
          trimmedCode,
        );

        switch (authResult.status) {
          case "invalid_or_expired":
            return { status: "invalid_or_expired_code" };
          case "rate_limited":
            return { status: "rate_limited" };
          case "unavailable":
            return { status: "temporarily_unavailable" };
          case "verified":
            return (await dependencies.memberSession.hasValidMemberSession())
              ? { status: "signed_in" }
              : { status: "temporarily_unavailable" };
        }
      } catch {
        return { status: "temporarily_unavailable" };
      }
    },
  };
}
