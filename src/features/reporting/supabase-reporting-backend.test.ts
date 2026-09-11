import { describe, expect, it, vi } from "vitest";

import { createSupabaseReportingBackend } from "./supabase-reporting-backend";

describe("Supabase reporting backend", () => {
  it("calls the trusted RPC without actor, subject or snapshot fields", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        result_status: "created",
        report_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }],
      error: null,
    });
    const backend = createSupabaseReportingBackend({ rpc });

    await expect(backend.createReport({
      targetType: "message",
      targetId: "42",
      reason: "harassment",
      details: "abusive",
    })).resolves.toEqual({
      status: "created",
      reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(rpc).toHaveBeenCalledWith("create_behavior_report", {
      target_type: "message",
      target_id: "42",
      report_reason: "harassment",
      report_details: "abusive",
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/actor|reported_user|snapshot/);
  });

  it("maps an idempotent retry and throws raw errors for service sanitization", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          result_status: "already_pending",
          report_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: "private evidence" } });
    const backend = createSupabaseReportingBackend({ rpc });
    const input = {
      targetType: "profile" as const,
      targetId: "22222222-2222-4222-8222-222222222222",
      reason: "spam" as const,
      details: null,
    };

    await expect(backend.createReport(input)).resolves.toEqual({
      status: "already_pending",
      reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    await expect(backend.createReport(input)).rejects.toEqual({
      message: "private evidence",
    });
  });
});
