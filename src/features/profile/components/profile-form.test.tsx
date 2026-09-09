// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ProfileActionState } from "../profile-action-state";
import { ProfileForm } from "./profile-form";

afterEach(cleanup);

describe("ProfileForm", () => {
  it("提供 15 字即时限制并展示服务端字段错误", async () => {
    const action = async (): Promise<ProfileActionState> => ({
      status: "invalid",
      message: "请检查填写的信息。",
      fieldErrors: { displayName: "显示名称最多 15 个字符。" },
    });

    render(
      <ProfileForm
        action={action}
        initialProfile={{
          displayName: "原名称",
          major: null,
          gradYear: null,
        }}
        submitLabel="保存资料"
      />,
    );

    const displayName = screen.getByLabelText<HTMLInputElement>("显示名称");
    expect(displayName.maxLength).toBe(15);
    expect(displayName.required).toBe(true);
    expect(displayName.value).toBe("原名称");

    fireEvent.change(displayName, {
      target: { value: "一二三四五六七八九十一二三四五六" },
    });
    fireEvent.submit(displayName.form!);

    expect(
      await screen.findByText("显示名称最多 15 个字符。"),
    ).toBeTruthy();
  });
});
