import { beforeEach, describe, expect, it, vi } from "vitest";

const productionService = vi.hoisted(() => ({
  saveProfile: vi.fn(),
}));
const productionBoundary = vi.hoisted(() => ({
  createService: vi.fn(),
}));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => navigation);
vi.mock("./production-profile-service", () => ({
  createProductionProfileService: productionBoundary.createService,
}));

import {
  completeProfileOnboardingAction,
  updateProfileAction,
} from "./actions";
import { initialProfileActionState } from "./profile-action-state";

function profileFormData() {
  const formData = new FormData();
  formData.set("displayName", "小明");
  formData.set("major", "Computer Science");
  formData.set("gradYear", "2028");
  return formData;
}

describe("Profile Server Actions", () => {
  beforeEach(() => {
    productionService.saveProfile.mockReset();
    productionBoundary.createService.mockReset();
    productionBoundary.createService.mockResolvedValue(productionService);
    navigation.redirect.mockClear();
  });

  it("把受限的字段错误返回给资料表单", async () => {
    productionService.saveProfile.mockResolvedValue({
      status: "invalid",
      fieldErrors: { displayName: "显示名称最多 15 个字符。" },
    });

    await expect(
      updateProfileAction(initialProfileActionState, profileFormData()),
    ).resolves.toEqual({
      status: "invalid",
      message: "请检查填写的信息。",
      fieldErrors: { displayName: "显示名称最多 15 个字符。" },
    });
    expect(productionService.saveProfile).toHaveBeenCalledWith({
      displayName: "小明",
      major: "Computer Science",
      gradYear: "2028",
    });
  });

  it("onboarding 保存成功后只跳转到站内路径", async () => {
    productionService.saveProfile.mockResolvedValue({ status: "saved" });
    const formData = profileFormData();
    formData.set("next", "https://evil.example/steal");

    await expect(
      completeProfileOnboardingAction(initialProfileActionState, formData),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(navigation.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("拒绝会被浏览器解释成站外地址的反斜杠路径", async () => {
    productionService.saveProfile.mockResolvedValue({ status: "saved" });
    const formData = profileFormData();
    formData.set("next", "/\\evil.example/steal");

    await expect(
      completeProfileOnboardingAction(initialProfileActionState, formData),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(navigation.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("保留登录前请求的合法站内路径", async () => {
    productionService.saveProfile.mockResolvedValue({ status: "saved" });
    const formData = profileFormData();
    formData.set("next", "/friends?tab=requests");

    await expect(
      completeProfileOnboardingAction(initialProfileActionState, formData),
    ).rejects.toThrow("NEXT_REDIRECT:/friends?tab=requests");
    expect(navigation.redirect).toHaveBeenCalledWith(
      "/friends?tab=requests",
    );
  });

  it("服务初始化失败时不向表单泄漏内部错误", async () => {
    productionBoundary.createService.mockRejectedValue(
      new Error("private environment detail"),
    );

    await expect(
      updateProfileAction(initialProfileActionState, profileFormData()),
    ).resolves.toEqual({
      status: "temporarily_unavailable",
      message: "资料暂时无法保存，请稍后重试。",
    });
  });
});
