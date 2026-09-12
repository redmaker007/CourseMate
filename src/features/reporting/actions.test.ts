import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));
const production = vi.hoisted(() => ({
  createProductionReportingService: vi.fn(),
}));

vi.mock("@/features/auth/session", () => auth);
vi.mock("./production-reporting-service", () => production);

import { submitBehaviorReportAction } from "./actions";

describe("report action", () => {
  beforeEach(() => {
    auth.getCurrentMember.mockReset();
    production.createProductionReportingService.mockReset();
  });

  it("authenticates again and ignores forged evidence form fields", async () => {
    const createReport = vi.fn().mockResolvedValue({
      status: "created",
      reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    auth.getCurrentMember.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      onboardingComplete: true,
    });
    production.createProductionReportingService.mockResolvedValue({ createReport });
    const form = new FormData();
    form.set("targetType", "message");
    form.set("targetId", "42");
    form.set("reason", "spam");
    form.set("details", "  text  ");
    form.set("reportedUserId", "forged");
    form.set("snapshot", "forged");

    const result = await submitBehaviorReportAction({ status: "idle", message: "" }, form);

    expect(createReport).toHaveBeenCalledWith({
      targetType: "message",
      targetId: "42",
      reason: "spam",
      details: "  text  ",
    });
    expect(result.status).toBe("created");
  });

  it("does not create a service for signed-out or incomplete members", async () => {
    auth.getCurrentMember.mockResolvedValueOnce(null).mockResolvedValueOnce({
      userId: "11111111-1111-4111-8111-111111111111",
      onboardingComplete: false,
    });

    await expect(submitBehaviorReportAction(
      { status: "idle", message: "" }, new FormData(),
    )).resolves.toMatchObject({ status: "unauthorized" });
    await expect(submitBehaviorReportAction(
      { status: "idle", message: "" }, new FormData(),
    )).resolves.toMatchObject({ status: "onboarding_required" });
    expect(production.createProductionReportingService).not.toHaveBeenCalled();
  });
});
