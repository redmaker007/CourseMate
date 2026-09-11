import type {
  CreateReportInput,
  CreateReportResult,
  ReportingBackend,
} from "./reporting-service";

type RpcResult = { data: unknown; error: unknown };
export type ReportingRpcClient = {
  rpc(name: string, arguments_: Record<string, unknown>): Promise<RpcResult>;
};

export function createSupabaseReportingBackend(
  client: ReportingRpcClient,
): ReportingBackend {
  return {
    async createReport(input: CreateReportInput): Promise<CreateReportResult> {
      const { data, error } = await client.rpc("create_behavior_report", {
        target_type: input.targetType,
        target_id: input.targetId,
        report_reason: input.reason,
        report_details: input.details,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      const status = String(row?.result_status ?? "temporarily_unavailable");
      const reportId = row?.report_id ? String(row.report_id) : undefined;
      if ((status === "created" || status === "already_pending") && reportId) {
        return { status, reportId };
      }
      if (
        [
          "invalid_target",
          "invalid_reason",
          "invalid_details",
          "self_report",
          "not_available",
          "onboarding_required",
        ].includes(status)
      ) {
        return { status } as CreateReportResult;
      }
      return { status: "temporarily_unavailable" };
    },
  };
}
