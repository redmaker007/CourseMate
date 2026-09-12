export type ReportActionState = {
  status: string;
  message: string;
  reportId?: string;
};

export const initialReportActionState: ReportActionState = {
  status: "idle",
  message: "",
};
