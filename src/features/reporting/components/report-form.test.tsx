// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportForm } from "./report-form";

afterEach(cleanup);

describe("report form", () => {
  it("submits only the target, reason and optional details", () => {
    render(
      <ReportForm
        action={vi.fn()}
        label="Report message"
        targetId="42"
        targetType="message"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Report message" }));
    const form = screen.getByRole("form", { name: "Report message" });
    expect(form.querySelector('[name="reportedUserId"]')).toBeNull();
    expect(form.querySelector('[name="snapshot"]')).toBeNull();
    expect(form.querySelector('[name="actorId"]')).toBeNull();
    expect(form.querySelector('[name="targetId"]')).toHaveProperty("value", "42");
  });

  it("requires details for other and renders malicious text as inert textarea content", () => {
    render(
      <ReportForm
        action={vi.fn()}
        label="Report profile"
        targetId="22222222-2222-4222-8222-222222222222"
        targetType="profile"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Report profile" }));
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "other" },
    });
    const details = screen.getByLabelText("Details") as HTMLTextAreaElement;
    fireEvent.change(details, { target: { value: "<script>alert(1)</script>" } });
    expect(details.value).toBe("<script>alert(1)</script>");
    expect(document.querySelector("script")).toBeNull();
    expect((screen.getByRole("button", { name: "Submit report" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });
});
