// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RequestEmailCodeActionState } from "../request-email-code-state";
import type { VerifyEmailCodeActionState } from "../verify-email-code-state";
import { RequestEmailCodeForm } from "./request-email-code-form";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe("RequestEmailCodeForm", () => {
  it("发码后不会把包含邮箱的验证上下文写入 React 警告", async () => {
    const verificationContext =
      "encoded-student@wisc.edu-context.signed-context";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const requestAction = async (): Promise<RequestEmailCodeActionState> => ({
      status: "code_sent",
      schoolId: "uw-madison",
      email: "student@wisc.edu",
      flowId: "non-sensitive-flow-id",
      message: "邮件服务已接受发送请求，请检查收件箱和垃圾邮件。",
      verificationContext,
    });
    const verifyAction = async (): Promise<VerifyEmailCodeActionState> => ({
      status: "signed_in",
      message: "邮箱验证成功，已登录。",
    });

    render(
      <RequestEmailCodeForm
        requestAction={requestAction}
        schools={[
          {
            emailDomains: ["wisc.edu"],
            id: "uw-madison",
            nameEn: "University of Wisconsin-Madison",
            nameZh: "威斯康星大学麦迪逊分校",
          },
        ]}
        verifyAction={verifyAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("学校邮箱"), {
      target: { value: "student@wisc.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));

    await screen.findByLabelText("6 位验证码");
    await waitFor(() => {
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
        verificationContext,
      );
    });
  });

  it("重发成功后清空验证码并重新开始六十秒倒计时", async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const requestAction = async (): Promise<RequestEmailCodeActionState> => {
      requestCount += 1;
      return {
        status: "code_sent",
        schoolId: "uw-madison",
        email: "student@wisc.edu",
        flowId: `flow-${requestCount}`,
        message: "邮件服务已接受发送请求，请检查收件箱和垃圾邮件。",
        verificationContext: `context-${requestCount}`,
      };
    };
    const verifyAction = async (): Promise<VerifyEmailCodeActionState> => ({
      status: "signed_in",
      message: "邮箱验证成功，已登录。",
    });

    render(
      <RequestEmailCodeForm
        requestAction={requestAction}
        schools={[
          {
            emailDomains: ["wisc.edu"],
            id: "uw-madison",
            nameEn: "University of Wisconsin-Madison",
            nameZh: "威斯康星大学麦迪逊分校",
          },
        ]}
        verifyAction={verifyAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("学校邮箱"), {
      target: { value: "student@wisc.edu" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
    });

    const codeInput = screen.getByLabelText<HTMLInputElement>("6 位验证码");
    fireEvent.change(codeInput, { target: { value: "123456" } });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新发送验证码" }));
    });

    expect(screen.getByLabelText<HTMLInputElement>("6 位验证码").value).toBe("");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "60 秒后可重新发送",
      }).disabled,
    ).toBe(true);
    expect(requestCount).toBe(2);
  });

  it("按邮箱后缀识别学校，认不出时说明开放了哪些后缀且不能发送", async () => {
    let submittedSchool: FormDataEntryValue | null = null;
    const requestAction = async (
      _state: RequestEmailCodeActionState,
      formData: FormData,
    ): Promise<RequestEmailCodeActionState> => {
      submittedSchool = formData.get("schoolId");
      return { status: "idle", message: "" };
    };
    const verifyAction = async (): Promise<VerifyEmailCodeActionState> => ({
      status: "idle",
      message: "",
    });

    render(
      <RequestEmailCodeForm
        requestAction={requestAction}
        schools={[
          {
            emailDomains: ["umich.edu"],
            id: "umich",
            nameEn: "University of Michigan–Ann Arbor",
            nameZh: "密歇根大学安娜堡分校",
          },
          {
            emailDomains: ["wisc.edu"],
            id: "uw-madison",
            nameEn: "University of Wisconsin-Madison",
            nameZh: "威斯康星大学麦迪逊分校",
          },
        ]}
        verifyAction={verifyAction}
      />,
    );

    const email = screen.getByLabelText("学校邮箱");
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "发送验证码" });

    // 没输入时列出开放的学校，安娜堡校区写清楚
    expect(screen.getByText(/密歇根大学安娜堡分校 · University of Michigan–Ann Arbor/)).toBeTruthy();
    expect(submit.disabled).toBe(true);

    fireEvent.change(email, { target: { value: "student@cs.wisc.edu" } });
    expect(screen.getByText(/暂不支持 @cs\.wisc\.edu/)).toBeTruthy();
    expect(submit.disabled).toBe(true);

    fireEvent.change(email, { target: { value: "Student@UMich.edu" } });
    expect(
      screen.getByText("已识别：密歇根大学安娜堡分校 · University of Michigan–Ann Arbor"),
    ).toBeTruthy();
    expect(submit.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(submit);
    });
    expect(submittedSchool).toBe("umich");
  });
});
