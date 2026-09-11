export const REPORT_TARGET_TYPES = [
  "friend_request",
  "message",
  "profile",
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  "harassment",
  "spam",
  "impersonation",
  "threat",
  "inappropriate",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type CreateReportInput = {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
};

export type CreateReportResult =
  | { status: "created" | "already_pending"; reportId: string }
  | {
      status:
        | "invalid_target"
        | "invalid_reason"
        | "invalid_details"
        | "self_report"
        | "not_available"
        | "onboarding_required"
        | "temporarily_unavailable";
    };

export interface ReportingBackend {
  createReport(input: CreateReportInput): Promise<CreateReportResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_BIGINT = /^[1-9][0-9]*$/;

export function createReportingService(backend: ReportingBackend) {
  return {
    async createReport(input: CreateReportInput): Promise<CreateReportResult> {
      if (!REPORT_TARGET_TYPES.includes(input.targetType)) {
        return { status: "invalid_target" };
      }
      const validTarget = input.targetType === "message"
        ? POSITIVE_BIGINT.test(input.targetId)
        : UUID.test(input.targetId);
      if (!validTarget) return { status: "invalid_target" };
      if (!REPORT_REASONS.includes(input.reason)) {
        return { status: "invalid_reason" };
      }

      const details = input.details?.trim() || null;
      const detailLength = details ? Array.from(details).length : 0;
      if (detailLength > 1000 || (input.reason === "other" && detailLength < 1)) {
        return { status: "invalid_details" };
      }

      try {
        return await backend.createReport({ ...input, details });
      } catch {
        return { status: "temporarily_unavailable" };
      }
    },
  };
}
