import { describe, expect, it, vi } from "vitest";

import {
  createReportingService,
  type ReportingBackend,
} from "./reporting-service";

function backend(overrides: Partial<ReportingBackend> = {}): ReportingBackend {
  return {
    createReport: vi.fn().mockResolvedValue({
      status: "created",
      reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
    ...overrides,
  };
}

describe("reporting service", () => {
  it("accepts only supported targets and reasons without accepting evidence fields", async () => {
    const createReport = vi.fn().mockResolvedValue({
      status: "created",
      reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const service = createReportingService(backend({ createReport }));

    await expect(
      service.createReport({
        targetType: "message",
        targetId: "42",
        reason: "harassment",
        details: "  repeated insults  ",
      }),
    ).resolves.toEqual({
      status: "created",
      reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(createReport).toHaveBeenCalledWith({
      targetType: "message",
      targetId: "42",
      reason: "harassment",
      details: "repeated insults",
    });
  });

  it("requires details for other and enforces the 1000 Unicode-character limit", async () => {
    const candidate = backend();
    const service = createReportingService(candidate);

    await expect(
      service.createReport({
        targetType: "profile",
        targetId: "22222222-2222-4222-8222-222222222222",
        reason: "other",
        details: "   ",
      }),
    ).resolves.toEqual({ status: "invalid_details" });
    await expect(
      service.createReport({
        targetType: "friend_request",
        targetId: "33333333-3333-4333-8333-333333333333",
        reason: "spam",
        details: "界".repeat(1001),
      }),
    ).resolves.toEqual({ status: "invalid_details" });
    expect(candidate.createReport).not.toHaveBeenCalled();
  });

  it("rejects malformed target identifiers and sanitizes backend failures", async () => {
    const candidate = backend({
      createReport: vi.fn().mockRejectedValue(new Error("private evidence")),
    });
    const service = createReportingService(candidate);

    await expect(
      service.createReport({
        targetType: "message",
        targetId: "1; drop table reports",
        reason: "threat",
        details: null,
      }),
    ).resolves.toEqual({ status: "invalid_target" });
    await expect(
      service.createReport({
        targetType: "profile",
        targetId: "22222222-2222-4222-8222-222222222222",
        reason: "spam",
        details: null,
      }),
    ).resolves.toEqual({ status: "temporarily_unavailable" });
  });
});
